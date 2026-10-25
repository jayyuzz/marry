// supabase.js — Supabase database helper for Marry
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false }
  });
}

// In-memory fallback if Supabase is offline/unconfigured
const memLimits = new Map();

/**
 * Check if a client (IP / device token) is allowed to perform an analysis.
 * Guests: allowed 1 free analysis.
 * Members: unlimited.
 */
export async function checkGuestLimit(identifier) {
  if (!identifier) return { allowed: true, isMember: false, count: 0 };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('guest_limits')
        .select('*')
        .eq('identifier', identifier)
        .maybeSingle();

      if (!error && data) {
        const isMember = Boolean(data.is_member);
        const count = Number(data.analyze_count || 0);
        return {
          allowed: isMember || count < 1,
          isMember,
          count
        };
      }
    } catch (e) {
      console.warn('Supabase checkGuestLimit fallback to memory:', e.message);
    }
  }

  const rec = memLimits.get(identifier) || { count: 0, isMember: false };
  return {
    allowed: rec.isMember || rec.count < 1,
    isMember: rec.isMember,
    count: rec.count
  };
}

/**
 * Increment the analysis count for an identifier.
 */
export async function incrementGuestUsage(identifier) {
  if (!identifier) return;

  if (supabase) {
    try {
      const { data } = await supabase
        .from('guest_limits')
        .select('analyze_count, is_member')
        .eq('identifier', identifier)
        .maybeSingle();

      const currentCount = Number(data?.analyze_count || 0);
      const isMember = Boolean(data?.is_member);

      await supabase.from('guest_limits').upsert({
        identifier,
        analyze_count: currentCount + 1,
        is_member: isMember,
        last_used: new Date().toISOString()
      });
      return;
    } catch (e) {
      console.warn('Supabase incrementGuestUsage fallback to memory:', e.message);
    }
  }

  const rec = memLimits.get(identifier) || { count: 0, isMember: false };
  rec.count += 1;
  memLimits.set(identifier, rec);
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
