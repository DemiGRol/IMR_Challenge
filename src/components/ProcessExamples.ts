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
];
