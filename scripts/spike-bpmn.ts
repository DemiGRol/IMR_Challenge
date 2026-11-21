import { layoutProcess } from 'bpmn-auto-layout';
import BpmnModdle from 'bpmn-moddle';

const FIXTURES: Record<string, string> = {
  linear: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Linear" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Inicio">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_1" name="Recibir solicitud">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_2" name="Validar datos">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1" name="Fin">
      <bpmn:incoming>Flow_3</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Task_2" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_2" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`,

  xor: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_2" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_XOR" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Pedido recibido">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:task id="Task_Check" name="Verificar stock">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:exclusiveGateway id="Gw_Stock" name="¿Hay stock?">
      <bpmn:incoming>Flow_2</bpmn:incoming>
      <bpmn:outgoing>Flow_Yes</bpmn:outgoing>
      <bpmn:outgoing>Flow_No</bpmn:outgoing>
    </bpmn:exclusiveGateway>
    <bpmn:task id="Task_Ship" name="Preparar envío">
      <bpmn:incoming>Flow_Yes</bpmn:incoming>
      <bpmn:outgoing>Flow_3</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_Reject" name="Notificar rechazo">
      <bpmn:incoming>Flow_No</bpmn:incoming>
      <bpmn:outgoing>Flow_4</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Ok" name="Pedido enviado">
      <bpmn:incoming>Flow_3</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Rej" name="Pedido rechazado">
      <bpmn:incoming>Flow_4</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_Check" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_Check" targetRef="Gw_Stock" />
    <bpmn:sequenceFlow id="Flow_Yes" name="Sí" sourceRef="Gw_Stock" targetRef="Task_Ship" />
    <bpmn:sequenceFlow id="Flow_No" name="No" sourceRef="Gw_Stock" targetRef="Task_Reject" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Task_Ship" targetRef="End_Ok" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_Reject" targetRef="End_Rej" />
  </bpmn:process>
</bpmn:definitions>`,

  parallel: `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_3" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_AND" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Orden aprobada">
      <bpmn:outgoing>Flow_1</bpmn:outgoing>
    </bpmn:startEvent>
    <bpmn:parallelGateway id="Gw_Split" name="Iniciar en paralelo">
      <bpmn:incoming>Flow_1</bpmn:incoming>
      <bpmn:outgoing>Flow_A</bpmn:outgoing>
      <bpmn:outgoing>Flow_B</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:task id="Task_Invoice" name="Emitir factura">
      <bpmn:incoming>Flow_A</bpmn:incoming>
      <bpmn:outgoing>Flow_C</bpmn:outgoing>
    </bpmn:task>
    <bpmn:task id="Task_Pack" name="Empaquetar pedido">
      <bpmn:incoming>Flow_B</bpmn:incoming>
      <bpmn:outgoing>Flow_D</bpmn:outgoing>
    </bpmn:task>
    <bpmn:parallelGateway id="Gw_Join" name="Unir flujos">
      <bpmn:incoming>Flow_C</bpmn:incoming>
      <bpmn:incoming>Flow_D</bpmn:incoming>
      <bpmn:outgoing>Flow_5</bpmn:outgoing>
    </bpmn:parallelGateway>
    <bpmn:endEvent id="End_1" name="Orden completada">
      <bpmn:incoming>Flow_5</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Gw_Split" />
    <bpmn:sequenceFlow id="Flow_A" sourceRef="Gw_Split" targetRef="Task_Invoice" />
    <bpmn:sequenceFlow id="Flow_B" sourceRef="Gw_Split" targetRef="Task_Pack" />
    <bpmn:sequenceFlow id="Flow_C" sourceRef="Task_Invoice" targetRef="Gw_Join" />
    <bpmn:sequenceFlow id="Flow_D" sourceRef="Task_Pack" targetRef="Gw_Join" />
    <bpmn:sequenceFlow id="Flow_5" sourceRef="Gw_Join" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`,
};

async function main() {
  const moddle = new BpmnModdle();
  let passed = 0;

  for (const [name, xml] of Object.entries(FIXTURES)) {
    const t0 = performance.now();
    const { warnings } = await moddle.fromXML(xml);
    const layouted = await layoutProcess(xml);
    const ms = Math.round(performance.now() - t0);
    const hasDi = layouted.includes('BPMNDiagram') && layouted.includes('BPMNPlane');
    console.log(`[${name}] moddleWarnings=${warnings.length} hasDI=${hasDi} latency=${ms}ms`);
    if (hasDi && warnings.length === 0) passed++;
  }

  console.log(`\nSpike BPMN pipeline result: ${passed}/${Object.keys(FIXTURES).length} passed.`);
  if (passed !== Object.keys(FIXTURES).length) process.exit(1);
}

main().catch((err) => {
  console.error('Spike failed:', err);
  process.exit(1);
});
