// supabase.js — Supabase database helper for Marry
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

export let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });
}

// In-memory fallback if Supabase is offline/unconfigured
const memLimits = new Map();

/**
 * Verify a user's Supabase JWT access token.
 */
export async function getUserFromToken(token) {
  if (!supabase || !token) return null;
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (!error && user) return user;
  } catch (e) {
    console.warn('getUserFromToken error:', e.message);
  }
  return null;
}

/**
 * Check if a client (IP, device token, or authenticated user ID) is allowed to perform an analysis.
 * Guests: allowed 1 free analysis.
 * Registered Free Users: allowed 3 free analyses.
 * Members: unlimited.
 */
export async function checkGuestLimit(identifier, userId = null) {
  const targetId = userId ? `user_${userId}` : identifier;
  if (!targetId) return { allowed: true, isMember: false, count: 0, limit: 1 };

  const freeLimit = userId ? 3 : 1;

  if (supabase) {
    try {
      // Check user record first if logged in
      let record = null;
      if (userId) {
        const { data } = await supabase
          .from('guest_limits')
          .select('*')
          .eq('identifier', `user_${userId}`)
          .maybeSingle();
        record = data;

        // Also check if user email was marked by Ko-fi webhook
        if (!record?.is_member) {
          try {
            const { data: { user } } = await supabase.auth.admin.getUserById(userId);
            if (user?.email) {
              const { data: emailRec } = await supabase
                .from('guest_limits')
                .select('*')
                .eq('identifier', `email_${user.email.toLowerCase()}`)
                .maybeSingle();
              if (emailRec?.is_member) {
                record = emailRec;
                // Sync user id record
                await supabase.from('guest_limits').upsert({
                  identifier: `user_${userId}`,
                  analyze_count: record.analyze_count || 0,
                  is_member: true,
                  last_used: new Date().toISOString()
                });
              }
            }
          } catch {}
        }
      }

      // Check device/IP identifier
      if (!record && identifier) {
        const { data } = await supabase
          .from('guest_limits')
          .select('*')
          .eq('identifier', identifier)
          .maybeSingle();
        record = data;
      }

      if (record) {
        const isMember = Boolean(record.is_member);
        const count = Number(record.analyze_count || 0);
        return {
          allowed: isMember || count < freeLimit,
          isMember,
          count,
          limit: isMember ? 9999 : freeLimit
        };
      }
    } catch (e) {
      console.warn('Supabase checkGuestLimit fallback to memory:', e.message);
    }
  }

  const rec = memLimits.get(targetId) || { count: 0, isMember: false };
  return {
    allowed: rec.isMember || rec.count < freeLimit,
    isMember: rec.isMember,
    count: rec.count,
    limit: rec.isMember ? 9999 : freeLimit
  };
}

/**
 * Increment the analysis count for an identifier or user.
 */
export async function incrementGuestUsage(identifier, userId = null) {
  const targetId = userId ? `user_${userId}` : identifier;
  if (!targetId) return;

  if (supabase) {
    try {
      const { data } = await supabase
        .from('guest_limits')
        .select('analyze_count, is_member')
        .eq('identifier', targetId)
        .maybeSingle();

      const currentCount = Number(data?.analyze_count || 0);
      const isMember = Boolean(data?.is_member);

      await supabase.from('guest_limits').upsert({
        identifier: targetId,
        analyze_count: currentCount + 1,
        is_member: isMember,
        last_used: new Date().toISOString()
      });
      return;
    } catch (e) {
      console.warn('Supabase incrementGuestUsage fallback to memory:', e.message);
    }
  }

  const rec = memLimits.get(targetId) || { count: 0, isMember: false };
  rec.count += 1;
  memLimits.set(targetId, rec);
}

/**
 * Activate membership automatically by user email (called by Ko-fi Webhook).
 */
export async function setMemberByEmail(email) {
  if (!email) return false;
  const cleanEmail = email.trim().toLowerCase();

  if (supabase) {
    try {
      // Find user id by email via admin auth API
      const { data: { users } } = await supabase.auth.admin.listUsers();
      const matched = users?.find(u => u.email?.toLowerCase() === cleanEmail);

      const targetIdentifier = matched ? `user_${matched.id}` : `email_${cleanEmail}`;

      const { data } = await supabase
        .from('guest_limits')
        .select('analyze_count')
        .eq('identifier', targetIdentifier)
        .maybeSingle();

      await supabase.from('guest_limits').upsert({
        identifier: targetIdentifier,
        analyze_count: data?.analyze_count || 0,
        is_member: true,
        last_used: new Date().toISOString()
      });

      // Also upsert email key if user was matched by id
      if (matched) {
        await supabase.from('guest_limits').upsert({
          identifier: `email_${cleanEmail}`,
          is_member: true,
          last_used: new Date().toISOString()
        });
      }
      return true;
    } catch (e) {
      console.warn('Supabase setMemberByEmail error:', e.message);
    }
  }

  memLimits.set(`email_${cleanEmail}`, { count: 0, isMember: true });
  return true;
}

/**
 * Record a visitor's country into Supabase.
 */
export async function recordVisitorCountry({ country, code, flag }) {
  if (!country) return;

  if (supabase) {
    try {
      const { data } = await supabase
        .from('visitor_stats')
        .select('count')
        .eq('country', country)
        .maybeSingle();

      const nextCount = (data?.count || 0) + 1;
      await supabase.from('visitor_stats').upsert({
        country,
        code: code || '',
        flag: flag || '🌐',
        count: nextCount,
        updated_at: new Date().toISOString()
      });
      return;
    } catch (e) {
      console.warn('Supabase recordVisitorCountry fallback:', e.message);
    }
  }
}

/**
 * Get visitor stats from Supabase.
 */
export async function getVisitorStatsFromDb() {
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('visitor_stats')
        .select('country, code, flag, count')
        .order('count', { ascending: false });

      if (!error && Array.isArray(data)) {
        const total = data.reduce((acc, row) => acc + (row.count || 0), 0);
        return {
          total,
          uniqueCountries: data.length,
          topCountries: data.slice(0, 15).map(r => ({
            name: r.country,
            count: r.count,
            flag: r.flag,
            code: r.code
          }))
        };
      }
    } catch (e) {
      console.warn('Supabase getVisitorStatsFromDb fallback:', e.message);
    }
  }
  return null;
}
