# Inventario de modelos

- **Estado**: `as-built` (`v0.7.3`, actualizado el `26/11/2026`).
- **Enfoque de diseño**: los modelos priorizan un nivel de abstracción adecuado y lenguaje comprensible tanto para perfiles de negocio como técnicos; el detalle de implementación, endpoints, códigos y esquemas se documenta en [contracts.md](../architecture/contracts.md) y [architecture/README.md](../architecture/README.md).

| Modelo | Propósito | Fuente editable | Estado | Disparador de actualización |
|---|---|---|---|---|
| [DFD-0](dfd-0.md) | Límite del sistema, actores externos y flujos de información | Markdown + Mermaid | `as-built (v0.7.3)` | Cambios de alcance, actores externos o integraciones IA |
| [Arquitectura](architecture.md) | Bloques constructivos (C4 Nivel 2) y relaciones principales | Markdown + Mermaid | `as-built (v0.7.3)` | Cambio de bloques del sistema o nuevo ADR |
| [Secuencia](sequence.md) | Interacción paso a paso para generar, refinar y auditar | Markdown + Mermaid | `as-built (v0.7.3)` | Cambio en los flujos principales de usuario/sistema |
| [Estados](states.md) | Estados observables del diagrama y transiciones de sesión | Markdown + Mermaid | `as-built (v0.7.3)` | Cambio en ciclo de trabajo, edición, cancelación o guardado |
| [USM / WBS Draw.io](IMR.drawio) | Fuente visual inicial de User Story Map y WBS (`T-02`) | XML `diagrams.net` | `histórico (T-02)` | Referencia de descubrimiento e historias iniciales |
| DER | Entidades relacionales y cardinalidad de base de datos | N/A | `no aplicable` | Solo aplica si se agrega persistencia en DB (`ADR-002` / `ADR-004`). Ver esquema cliente en [contracts.md](../architecture/contracts.md). |

> Cada modelo conserva fuente editable en texto plano (Mermaid) o XML (`IMR.drawio`) y distingue explícitamente documentación `as-built` de artefactos históricos de inicio.
