import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://ltmbliusizokulbbpgir.supabase.co';
const supabaseKey = 'sb_publishable_x1vBxmCXfjEA7ckz8wWnvA_-1pbt8IW'; // anon key
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
  const { data: buckets, error: bucketError } = await supabase.storage.listBuckets();
  console.log('Buckets:', buckets, bucketError);

  const { data: tables, error: tableError } = await supabase.from('photo_sessions').select('*').limit(5);
  console.log('Table photo_sessions:', tables, tableError);
}

check();
