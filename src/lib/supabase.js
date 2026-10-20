import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)
export const supabase = configured ? createClient(url, key) : null

// Which patch in supabase/ adds each database function.
const PATCH = {
  record_sale: '009_members.sql',
  void_sale: '001_pos_patch.sql',
  set_stock_count: '002_inventory.sql',
  sales_report: '003_reports.sql',
  delete_product: '004_admin_sales_delete.sql',
  staff_list: '005_staff.sql',
  sales_export: '010_sales_export.sql',
}

// A function Supabase can't find means a patch hasn't been run yet; say which one instead of the raw error.
export function explain(fn, error) {
  if (!error || !/could not find the function/i.test(error.message)) return error
  return { ...error, message: `The database is missing an update. In Supabase › SQL Editor, run supabase/${PATCH[fn] ?? 'the newest patch'}, then refresh this page.` }
}

if (supabase) {
  const rpc = supabase.rpc.bind(supabase)
  supabase.rpc = (fn, args, opts) => rpc(fn, args, opts).then((r) => ({ ...r, error: explain(fn, r.error) }))
}
