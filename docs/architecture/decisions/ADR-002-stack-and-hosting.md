# ADR-002: Stack tecnológico y hosting público gratuito

- **Estado**: aprobado (21/11/2026)
- **Requisitos**: `REQ-01`, `REQ-06`, `US-06`, `NFR-01`, `NFR-02`

## Contexto
El proyecto dispone de 10–15 horas totales, requiere opciones 100% gratuitas, despliegue público HTTPS sin exponer credenciales LLM en el navegador y ejecución local reproducible.

## Alternativas evaluadas
1. **Next.js (App Router, TypeScript) en Vercel Hobby (Elegida)**: \$0 sin tarjeta, 1 repo, 1 despliegue, Route Handlers server-side, timeout hasta 300 s (Fluid Compute), HTTPS automático.
2. **React (Vite) + Express en GCP Cloud Run**: \$0 Always Free (+ \$300 crédito), pero requiere `Dockerfile`, IAM y mayor setup operativo.
3. **Vite en Vercel + API en Render Free / Railway**: 2 despliegues, CORS y cold starts de 30–60 s en Render Free.

## Decisión
Utilizar **Next.js (App Router, TypeScript)** desplegado en **Vercel Hobby (\$0)**. El editor `bpmn-js` se cargará exclusivamente en cliente (`'use client'` + `next/dynamic(..., { ssr: false })`). El rate limiting MVP será *in-memory* por IP en el Route Handler (migrable a Redis en producción).

## Consecuencias y rollback
- **Costo de oportunidad**: acoplamiento parcial a Vercel y rate limiting local por instancia serverless (sin estado compartido entre instancias).
- **Rollback**: portable a GCP Cloud Run mediante `output: 'standalone'` y un `Dockerfile` estándar si Vercel presentara limitaciones.
