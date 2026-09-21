// Copy to supabase-config.js after the Supabase project is created.
// The anon key is safe to expose in the browser ONLY together with RLS policies.
// Never put the service_role key in GitHub or in the browser.
window.SPEKTRA_SUPABASE = {
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_KEY"
};
