/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  // Si en el futuro agregás más variables al .env, las sumás acá
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}