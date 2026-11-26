# Diagrama de Estados — Ciclo de Vida del Diagrama

- **Estado**: `as-built` (`v0.7.3`, verificado el `26/11/2026`).
- **Propósito**: mostrar los estados observables por el usuario durante una sesión de trabajo y qué acciones provocan el cambio de un estado a otro.

```mermaid
stateDiagram-v2
    [*] --> SinDiagrama : Abrir aplicación nueva
    [*] --> DiagramaListo : Restaurar última sesión guardada

    SinDiagrama --> Generando : Solicitar generación desde texto
    SinDiagrama --> DiagramaListo : Crear en blanco o importar archivo BPMN

    Generando --> DiagramaListo : Diagrama generado correctamente
    Generando --> SinDiagrama : Cancelar o error sin diagrama previo
    Generando --> EditadoManualmente : Cancelar o error conservando ediciones previas

    DiagramaListo --> EditadoManualmente : Modificar elementos en el lienzo
    DiagramaListo --> Generando : Regenerar desde el texto
    DiagramaListo --> DiagramaListo : Importar otro archivo o descargar diagrama

    EditadoManualmente --> EditadoManualmente : Nuevos ajustes, guardado automático o auditoría de supuestos
    EditadoManualmente --> DiagramaListo : Deshacer todos los cambios
    EditadoManualmente --> Generando : Refinar conservando ediciones o reiniciar desde cero

    note right of EditadoManualmente
        Tanto sobre un diagrama listo como editado
        se puede auditar supuestos, copiar el código
        o exportar el resultado sin perder cambios.
    end note
```

### Estados principales
- **Sin diagrama**: pantalla inicial lista para redactar una descripción, elegir un ejemplo o abrir un lienzo en blanco.
- **Generando**: espera activa con barra de progreso mientras se interpreta el texto y se diseña el diagrama (permite cancelar en cualquier momento).
- **Diagrama listo**: diagrama generado por IA, importado o en blanco, listo para inspeccionar, auditar o exportar.
- **Editado manualmente**: el usuario modificó elementos en el lienzo; el sistema protege esos cambios con guardado automático y permite refinar con IA sin sobrescribirlos.
