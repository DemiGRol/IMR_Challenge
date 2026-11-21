# ADR-003: Proveedor LLM primario (Vertex AI) y patrón LLM Adapter

- **Estado**: aprobado (21/11/2026)
- **Requisitos**: `REQ-02`, `REQ-03`, `US-02`, `NFR-01`, `NFR-03`

## Contexto
Se requiere invocar un LLM desde el servidor protegiendo credenciales, con opciones gratuitas (crédito de \$300 en GCP) y diseño extensible para cambiar de proveedor o agregar fallback.

## Decisión
1. **Proveedor primario MVP**: **Vertex AI en GCP** (modelos Gemini, financiado con el crédito gratuito de \$300), autenticado mediante variables de entorno del lado servidor (nunca en repositorio ni navegador).
2. **Patrón LLM Adapter**: definir una interfaz `LlmProvider` y un adaptador `ResilientLlmAdapter` con timeout acotado (`AbortSignal.timeout`, 20–30 s) que desacople la lógica de negocio del SDK de Vertex AI.
3. **Fallback entre proveedores**: movido a **P1** para proteger el presupuesto de 10–15 h del MVP. La interfaz del Adapter queda lista para enchufar un proveedor secundario (p. ej. Groq Free o Google AI Studio) sin modificar dominio ni UI.

## Consecuencias y rollback
- **Ventajas**: garantías de privacidad enterprise de Vertex AI, cuotas predecibles y arquitectura extensible.
- **Riesgo a validar en `T-04`**: configuración de credenciales de Service Account de GCP en Vercel (vía env var JSON/base64 sin archivo en disco).
- **Rollback**: implementar `GoogleAiStudioProvider` (solo requiere `GEMINI_API_KEY`) sobre la misma interfaz `LlmProvider` si la autenticación de Vertex AI en Vercel generara fricción excesiva.
