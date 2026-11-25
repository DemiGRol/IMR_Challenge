export interface ProcessExample {
  id: string;
  label: string;
  description: string;
}

export const PROCESS_EXAMPLES: ProcessExample[] = [
  {
    id: 'linear',
    label: 'Solicitud simple (Lineal)',
    description:
      'El empleado completa una solicitud de vacaciones. Recursos Humanos verifica los días disponibles, el gerente registra la aprobación en el sistema y se notifica al empleado por correo electrónico.',
  },
  {
    id: 'xor',
    label: 'Pedido con stock (XOR)',
    description:
      'El cliente envía un pedido. El sistema verifica si hay stock disponible. Si hay stock, se prepara el envío y se emite la factura en paralelo, y luego se cierra el pedido. Si no hay stock, se notifica el rechazo al cliente y finaliza el proceso.',
  },
  {
    id: 'parallel',
    label: 'Onboarding (Paralelo AND)',
    description:
      'Al firmar el contrato de un nuevo empleado, se inicia el proceso de incorporación. En paralelo, IT crea las cuentas de acceso y prepara la notebook, mientras Administración gestiona el alta legal. Cuando ambas actividades terminan, se realiza la inducción inicial y finaliza el onboarding.',
  },
  {
    id: 'collaboration-events',
    label: 'Colaboración y eventos (V4)',
    description:
      'El proceso de la Empresa inicia al recibir un mensaje de solicitud de compra en el área de Compras. Primero, Finanzas verifica el presupuesto disponible; si no alcanza, se cierra como solicitud rechazada por error presupuestario. Si hay presupuesto, Compras envía la orden de compra al Proveedor externo y queda esperando la respuesta: si recibe la confirmación del Proveedor antes de las 48 horas, Finanzas procesa el pago y el proceso finaliza como compra completada; si se cumple el plazo de 48 horas sin respuesta, Compras emite una alerta de escalamiento por demora y finaliza como orden cancelada.',
  },
];
