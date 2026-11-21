# Configuración operativa de GCP / Vertex AI (sin secretos)

- **Estado**: verificado en spike `T-04` (21/11/2026).
- **Referencia**: [ADR-003](decisions/ADR-003-llm-provider-adapter.md), [.env.example](../../.env.example).

## Configuración verificada
| Variable | Valor / Formato | Notas operativas |
|---|---|---|
| `GCP_PROJECT_ID` | ID del proyecto GCP (ej. `imr-challenge`) | Debe tener **Vertex AI API** habilitada y **Billing** (Free Trial \$300) vinculado. |
| `GCP_LOCATION` | **`global`** | **Crítico**: `gemini-4-hydrogen` devuelve `404 NOT_FOUND` en `us-central1`; requiere `global`. |
| `VERTEX_MODEL` | **`gemini-4-hydrogen`** | ID de publisher verificado: `publishers/google/models/gemini-4-hydrogen`. |
| `GCP_SERVICE_ACCOUNT_JSON` | JSON en una línea o **Base64** *(recomendado)* | Service Account con rol mínimo **`Vertex AI User`** (`roles/aiplatform.user`). En `.env.local` evitar JSON multilínea; usar Base64 para compatibilidad directa con local y Vercel. |

## Generación de Base64 local (PowerShell, sin imprimir secretos)
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("RUTA\A\TU\CLAVE.json")) | Set-Clipboard
```

## Reglas de seguridad
- Nunca commitear `.env.local` ni archivos `.json` de credenciales (`.env.*` está ignorado en `.gitignore`).
- En Vercel, cargar las 4 variables en *Project Settings → Environment Variables* (server-only, sin prefijo `NEXT_PUBLIC_`).
- Nota de despliegue: al modificar `.env.local` en local, reiniciar `npm run dev` para que Next.js recargue las variables.
