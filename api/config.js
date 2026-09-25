// Función serverless de Vercel: entrega al navegador la URL de Supabase y la
// clave pública (publishable/anon) desde las variables de entorno.
// Así ninguna clave queda escrita en el repositorio.
// NUNCA configurar acá la clave "service_role" / "secret".
export default function handler(req, res) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    res.status(500).json({ error: 'Faltan las variables SUPABASE_URL y SUPABASE_ANON_KEY en Vercel.' });
    return;
  }
  if (/service_role|sb_secret_/.test(key) || key.includes('"role":"service_role"')) {
    res.status(500).json({ error: 'SUPABASE_ANON_KEY contiene una clave secreta. Usá la clave publishable.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ url, key });
}
