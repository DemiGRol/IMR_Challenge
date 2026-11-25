import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAndLayoutBpmn,
  BpmnValidationError,
  compactBpmnForPrompt,
} from '../src/lib/bpmn/validator.ts';
import { separateOverlappingEdges } from '../src/lib/bpmn/layout-postprocess.ts';
import { buildFallbackLayout } from '../src/lib/bpmn/fallback-layout.ts';
import { buildCacheKey, getCachedBpmn, setCachedBpmn } from '../src/lib/cache.ts';
import { checkRateLimit } from '../src/lib/rate-limit.ts';
import { estimateCostUsd } from '../src/lib/telemetry.ts';

const VALID_LINEAR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Inicio"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_1" name="Revisar pedido"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="End_1" name="Fin"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

test('validateAndLayoutBpmn accepts valid BPMN 2.0 XML and generates DI', async () => {
  const layouted = await validateAndLayoutBpmn(VALID_LINEAR_XML);
  assert.ok(layouted.includes('BPMNDiagram'));
  assert.ok(layouted.includes('BPMNShape'));
  assert.ok(layouted.includes('BPMNEdge'));
});

test('validateAndLayoutBpmn blocks XXE DOCTYPE directives', async () => {
  const xxeXml = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>${VALID_LINEAR_XML}`;
  await assert.rejects(() => validateAndLayoutBpmn(xxeXml), BpmnValidationError);
});

test('validateAndLayoutBpmn blocks script tags', async () => {
  const xssXml = VALID_LINEAR_XML.replace('Revisar pedido', '<script>alert(1)</script>');
  await assert.rejects(() => validateAndLayoutBpmn(xssXml), BpmnValidationError);
});

test('validateAndLayoutBpmn rejects duplicate element IDs', async () => {
  const dupXml = VALID_LINEAR_XML.replace('id="Task_1"', 'id="Start_1"');
  await assert.rejects(() => validateAndLayoutBpmn(dupXml), BpmnValidationError);
});

test('validateAndLayoutBpmn rejects out-of-scope SubProcess elements', async () => {
  const subXml = VALID_LINEAR_XML.replace('<bpmn:userTask', '<bpmn:subProcess').replace(
    '</bpmn:userTask>',
    '</bpmn:subProcess>'
  );
  await assert.rejects(() => validateAndLayoutBpmn(subXml), BpmnValidationError);
});

test('cache normalizes whitespace/case and isolates detailed vs fast modes', () => {
  const k1 = buildCacheKey('  Proceso   de   Compras ', 'detailed');
  const k2 = buildCacheKey('proceso de compras', 'detailed');
  const k3 = buildCacheKey('proceso de compras', 'fast');
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);

  setCachedBpmn(k1, {
    bpmnXml: VALID_LINEAR_XML,
    assumptions: [],
    provider: 'vertex-ai',
    model: 'gemini-4-hydrogen',
  });
  const hit = getCachedBpmn(k2);
  assert.ok(hit);
  assert.equal(hit.provider, 'vertex-ai');
  assert.equal(getCachedBpmn(k3), null);
});

test('rate limiter allows 10 requests and blocks the 11th', () => {
  const ip = `test-ip-${Date.now()}`;
  for (let i = 0; i < 10; i++) {
    assert.equal(checkRateLimit(ip).allowed, true);
  }
  const blocked = checkRateLimit(ip);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSec >= 1);
});

test('separateOverlappingEdges moves overlapping horizontal loop detours to distinct Y channels', () => {
  const overlappingXml = `
    <bpmndi:BPMNEdge id="Edge_1">
      <omgdi:waypoint x="300" y="120" />
      <omgdi:waypoint x="300" y="220" />
      <omgdi:waypoint x="100" y="220" />
      <omgdi:waypoint x="100" y="120" />
    </bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Edge_2">
      <omgdi:waypoint x="200" y="120" />
      <omgdi:waypoint x="200" y="220" />
      <omgdi:waypoint x="450" y="220" />
      <omgdi:waypoint x="450" y="120" />
    </bpmndi:BPMNEdge>
  `;
  const separated = separateOverlappingEdges(overlappingXml);
  assert.ok(separated.includes('y="220"'));
  assert.ok(separated.includes('y="246"'));
});

test('compactBpmnForPrompt strips BPMNDiagram, comments, and whitespace', () => {
  const withDi = `${VALID_LINEAR_XML.replace(
    '</bpmn:definitions>',
    '<!-- note --><bpmndi:BPMNDiagram id="D1"><bpmndi:BPMNPlane id="P1" /></bpmndi:BPMNDiagram></bpmn:definitions>'
  )}`;
  const compact = compactBpmnForPrompt(withDi);
  assert.ok(!compact.includes('BPMNDiagram'));
  assert.ok(!compact.includes('<!-- note -->'));
  assert.ok(compact.includes('<bpmn:process'));
});

test('buildFallbackLayout generates valid BPMNDiagram DI even for cyclic graphs', () => {
  const flowElements = [
    { $type: 'bpmn:StartEvent', id: 'Start_1' },
    { $type: 'bpmn:UserTask', id: 'Task_1' },
    { $type: 'bpmn:EndEvent', id: 'End_1' },
    { $type: 'bpmn:SequenceFlow', id: 'Flow_1', sourceRef: { id: 'Start_1' }, targetRef: { id: 'Task_1' } },
    { $type: 'bpmn:SequenceFlow', id: 'Flow_2', sourceRef: { id: 'Task_1' }, targetRef: { id: 'End_1' } },
    { $type: 'bpmn:SequenceFlow', id: 'Flow_Back', sourceRef: { id: 'Task_1' }, targetRef: { id: 'Start_1' } },
  ];
  const xml = buildFallbackLayout(VALID_LINEAR_XML, 'Process_1', flowElements);
  assert.ok(xml.includes('BPMNDiagram_Fallback'));
  assert.ok(xml.includes('bpmnElement="Task_1"'));
  assert.ok(xml.includes('bpmnElement="Flow_Back"'));
});

const VALID_COLLAB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_Collab" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_Emp" name="Empresa" processRef="Process_Emp" />
    <bpmn:participant id="Participant_Prov" name="Proveedor" />
    <bpmn:messageFlow id="Msg_1" name="Orden" sourceRef="Task_Send" targetRef="Participant_Prov" />
    <bpmn:messageFlow id="Msg_2" name="Confirmación" sourceRef="Participant_Prov" targetRef="Catch_Msg" />
  </bpmn:collaboration>
  <bpmn:process id="Process_Emp" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Compras" name="Compras">
        <bpmn:flowNodeRef>Start_C</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Send</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gw_Wait</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Catch_Msg</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Catch_Timer</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Throw_Esc</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Cancel</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Finanzas" name="Finanzas">
        <bpmn:flowNodeRef>Task_Pay</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Done</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_C" name="Solicitud recibida">
      <bpmn:outgoing>F1</bpmn:outgoing>
      <bpmn:messageEventDefinition id="MDef_Start" />
    </bpmn:startEvent>
    <bpmn:sendTask id="Task_Send" name="Enviar orden">
      <bpmn:incoming>F1</bpmn:incoming>
      <bpmn:outgoing>F2</bpmn:outgoing>
    </bpmn:sendTask>
    <bpmn:eventBasedGateway id="Gw_Wait" name="Esperar respuesta">
      <bpmn:incoming>F2</bpmn:incoming>
      <bpmn:outgoing>F_Msg</bpmn:outgoing>
      <bpmn:outgoing>F_Time</bpmn:outgoing>
    </bpmn:eventBasedGateway>
    <bpmn:intermediateCatchEvent id="Catch_Msg" name="Confirmación recibida">
      <bpmn:incoming>F_Msg</bpmn:incoming>
      <bpmn:outgoing>F3</bpmn:outgoing>
      <bpmn:messageEventDefinition id="MDef_Catch" />
    </bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="Catch_Timer" name="48 horas">
      <bpmn:incoming>F_Time</bpmn:incoming>
      <bpmn:outgoing>F4</bpmn:outgoing>
      <bpmn:timerEventDefinition id="TDef_1" />
    </bpmn:intermediateCatchEvent>
    <bpmn:intermediateThrowEvent id="Throw_Esc" name="Escalar demora">
      <bpmn:incoming>F4</bpmn:incoming>
      <bpmn:outgoing>F5</bpmn:outgoing>
      <bpmn:escalationEventDefinition id="EDef_1" />
    </bpmn:intermediateThrowEvent>
    <bpmn:task id="Task_Pay" name="Procesar pago">
      <bpmn:incoming>F3</bpmn:incoming>
      <bpmn:outgoing>F6</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_Done" name="Compra completada">
      <bpmn:incoming>F6</bpmn:incoming>
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Cancel" name="Orden cancelada">
      <bpmn:incoming>F5</bpmn:incoming>
      <bpmn:errorEventDefinition id="ErrDef_1" />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start_C" targetRef="Task_Send" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Send" targetRef="Gw_Wait" />
    <bpmn:sequenceFlow id="F_Msg" sourceRef="Gw_Wait" targetRef="Catch_Msg" />
    <bpmn:sequenceFlow id="F_Time" sourceRef="Gw_Wait" targetRef="Catch_Timer" />
    <bpmn:sequenceFlow id="F3" sourceRef="Catch_Msg" targetRef="Task_Pay" />
    <bpmn:sequenceFlow id="F4" sourceRef="Catch_Timer" targetRef="Throw_Esc" />
    <bpmn:sequenceFlow id="F5" sourceRef="Throw_Esc" targetRef="End_Cancel" />
    <bpmn:sequenceFlow id="F6" sourceRef="Task_Pay" targetRef="End_Done" />
  </bpmn:process>
</bpmn:definitions>`;

test('validateAndLayoutBpmn handles Collaboration with Pools, Lanes, MessageFlows, and typed events', async () => {
  const layouted = await validateAndLayoutBpmn(VALID_COLLAB_XML);
  assert.ok(layouted.includes('bpmnElement="Collaboration_1"'));
  assert.ok(layouted.includes('bpmnElement="Participant_Emp" isHorizontal="true"'));
  assert.ok(layouted.includes('bpmnElement="Participant_Prov" isHorizontal="true"'));
  assert.ok(layouted.includes('bpmnElement="Lane_Compras" isHorizontal="true"'));
  assert.ok(layouted.includes('bpmnElement="Lane_Finanzas" isHorizontal="true"'));
  assert.ok(layouted.includes('bpmnElement="Msg_1"'));
  assert.ok(layouted.includes('bpmnElement="Msg_2"'));

  const timerBoundsMatch = layouted.match(
    /id="Catch_Timer_di"[^>]*>[\s\S]*?<omgdc:Bounds[^>]*y="(\d+)"/
  );
  const msgBoundsMatch = layouted.match(
    /id="Catch_Msg_di"[^>]*>[\s\S]*?<omgdc:Bounds[^>]*y="(\d+)"/
  );
  assert.ok(timerBoundsMatch && msgBoundsMatch, 'Timer and Message catch events must have DI bounds');
  const timerY = Number(timerBoundsMatch[1]);
  const msgY = Number(msgBoundsMatch[1]);
  assert.ok(
    timerY < msgY,
    `Expected Catch_Timer (y=${timerY}) above Catch_Msg (y=${msgY}) to avoid crossings`
  );
});

test('validateAndLayoutBpmn handles single Process with LaneSet without Collaboration', async () => {
  const laneOnlyXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_Lanes" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_L" isExecutable="false">
    <bpmn:laneSet id="LS_1">
      <bpmn:lane id="Lane_A" name="Área A">
        <bpmn:flowNodeRef>S_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T_1</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_B" name="Área B">
        <bpmn:flowNodeRef>E_1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S_1" name="Inicio"><bpmn:outgoing>FL_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T_1" name="Ejecutar"><bpmn:incoming>FL_1</bpmn:incoming><bpmn:outgoing>FL_2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E_1" name="Fin"><bpmn:incoming>FL_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="FL_1" sourceRef="S_1" targetRef="T_1" />
    <bpmn:sequenceFlow id="FL_2" sourceRef="T_1" targetRef="E_1" />
  </bpmn:process>
</bpmn:definitions>`;
  const layouted = await validateAndLayoutBpmn(laneOnlyXml);
  assert.ok(layouted.includes('bpmnElement="Process_L"'));
  assert.ok(layouted.includes('bpmnElement="Lane_A" isHorizontal="true"'));
  assert.ok(layouted.includes('bpmnElement="Lane_B" isHorizontal="true"'));
});

test('validateAndLayoutBpmn accepts Timer, Message, Escalation, Error events and EventBasedGateway in simple process', async () => {
  const eventsXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_Ev" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Ev" isExecutable="false">
    <bpmn:startEvent id="S1" name="Inicio"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:eventBasedGateway id="G1" name="Esperar"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing><bpmn:outgoing>F3</bpmn:outgoing></bpmn:eventBasedGateway>
    <bpmn:intermediateCatchEvent id="C1" name="48h"><bpmn:incoming>F2</bpmn:incoming><bpmn:outgoing>F4</bpmn:outgoing><bpmn:timerEventDefinition id="TD1" /></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="C2" name="Aviso"><bpmn:incoming>F3</bpmn:incoming><bpmn:outgoing>F5</bpmn:outgoing><bpmn:messageEventDefinition id="MD1" /></bpmn:intermediateCatchEvent>
    <bpmn:intermediateThrowEvent id="T1" name="Alerta"><bpmn:incoming>F4</bpmn:incoming><bpmn:outgoing>F6</bpmn:outgoing><bpmn:escalationEventDefinition id="ED1" /></bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="E1" name="Error"><bpmn:incoming>F6</bpmn:incoming><bpmn:errorEventDefinition id="Err1" /></bpmn:endEvent>
    <bpmn:endEvent id="E2" name="OK"><bpmn:incoming>F5</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S1" targetRef="G1" />
    <bpmn:sequenceFlow id="F2" sourceRef="G1" targetRef="C1" />
    <bpmn:sequenceFlow id="F3" sourceRef="G1" targetRef="C2" />
    <bpmn:sequenceFlow id="F4" sourceRef="C1" targetRef="T1" />
    <bpmn:sequenceFlow id="F5" sourceRef="C2" targetRef="E2" />
    <bpmn:sequenceFlow id="F6" sourceRef="T1" targetRef="E1" />
  </bpmn:process>
</bpmn:definitions>`;
  const layouted = await validateAndLayoutBpmn(eventsXml);
  assert.ok(layouted.includes('BPMNDiagram'));
  assert.ok(layouted.includes('bpmnElement="C1"'));
  assert.ok(layouted.includes('bpmnElement="T1"'));
});

test('validateAndLayoutBpmn rejects intra-pool MessageFlow', async () => {
  const intraPoolXml = VALID_COLLAB_XML.replace(
    'sourceRef="Task_Send" targetRef="Participant_Prov"',
    'sourceRef="Task_Send" targetRef="Task_Pay"'
  );
  await assert.rejects(() => validateAndLayoutBpmn(intraPoolXml), BpmnValidationError);
});

test('validateAndLayoutBpmn handles interrupting and non-interrupting BoundaryEvents with Collaboration and Lanes', async () => {
  const boundaryCollabXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_BndCollab" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_Bnd">
    <bpmn:participant id="Part_Org" name="Empresa" processRef="Proc_Org" />
  </bpmn:collaboration>
  <bpmn:process id="Proc_Org" isExecutable="false">
    <bpmn:laneSet id="LS_Bnd">
      <bpmn:lane id="Lane_Ops" name="Operaciones">
        <bpmn:flowNodeRef>Start_B</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Approve</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Boundary_Err</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Boundary_Timer</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_NormalNext</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_ErrHandler</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Reminder</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_B</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_B" name="Inicio"><bpmn:outgoing>FB_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="Task_Approve" name="Aprobar solicitud"><bpmn:incoming>FB_1</bpmn:incoming><bpmn:outgoing>FB_2</bpmn:outgoing></bpmn:userTask>
    <bpmn:boundaryEvent id="Boundary_Err" name="Error de sistema" attachedToRef="Task_Approve"><bpmn:outgoing>FB_Err</bpmn:outgoing><bpmn:errorEventDefinition id="ErrDef_B" /></bpmn:boundaryEvent>
    <bpmn:boundaryEvent id="Boundary_Timer" name="Demora 48h" cancelActivity="false" attachedToRef="Task_Approve"><bpmn:outgoing>FB_Tim</bpmn:outgoing><bpmn:timerEventDefinition id="TimDef_B" /></bpmn:boundaryEvent>
    <bpmn:task id="Task_NormalNext" name="Continuar trámite"><bpmn:incoming>FB_2</bpmn:incoming><bpmn:outgoing>FB_3</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Task_ErrHandler" name="Registrar falla"><bpmn:incoming>FB_Err</bpmn:incoming><bpmn:outgoing>FB_4</bpmn:outgoing></bpmn:task>
    <bpmn:sendTask id="Task_Reminder" name="Enviar recordatorio"><bpmn:incoming>FB_Tim</bpmn:incoming><bpmn:outgoing>FB_5</bpmn:outgoing></bpmn:sendTask>
    <bpmn:endEvent id="End_B" name="Fin"><bpmn:incoming>FB_3</bpmn:incoming><bpmn:incoming>FB_4</bpmn:incoming><bpmn:incoming>FB_5</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="FB_1" sourceRef="Start_B" targetRef="Task_Approve" />
    <bpmn:sequenceFlow id="FB_2" sourceRef="Task_Approve" targetRef="Task_NormalNext" />
    <bpmn:sequenceFlow id="FB_Err" sourceRef="Boundary_Err" targetRef="Task_ErrHandler" />
    <bpmn:sequenceFlow id="FB_Tim" sourceRef="Boundary_Timer" targetRef="Task_Reminder" />
    <bpmn:sequenceFlow id="FB_3" sourceRef="Task_NormalNext" targetRef="End_B" />
    <bpmn:sequenceFlow id="FB_4" sourceRef="Task_ErrHandler" targetRef="End_B" />
    <bpmn:sequenceFlow id="FB_5" sourceRef="Task_Reminder" targetRef="End_B" />
  </bpmn:process>
</bpmn:definitions>`;

  const layouted = await validateAndLayoutBpmn(boundaryCollabXml);
  assert.ok(layouted.includes('cancelActivity="false"'));

  const hostMatch = layouted.match(
    /id="Task_Approve_di"[^>]*>[\s\S]*?<omgdc:Bounds x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/
  );
  const errMatch = layouted.match(
    /id="Boundary_Err_di"[^>]*>[\s\S]*?<omgdc:Bounds x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/
  );
  const timMatch = layouted.match(
    /id="Boundary_Timer_di"[^>]*>[\s\S]*?<omgdc:Bounds x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/
  );
  assert.ok(hostMatch && errMatch && timMatch, 'Host task and both boundary events must have DI bounds');

  const hostY = Number(hostMatch[2]);
  const hostH = Number(hostMatch[4]);
  const expectedBoundaryY = hostY + hostH - 18;
  assert.equal(Number(errMatch[2]), expectedBoundaryY);
  assert.equal(Number(timMatch[2]), expectedBoundaryY);

  const normalNextMatch = layouted.match(
    /id="Task_NormalNext_di"[^>]*>[\s\S]*?<omgdc:Bounds[^>]*y="(\d+)"/
  );
  const errHandlerMatch = layouted.match(
    /id="Task_ErrHandler_di"[^>]*>[\s\S]*?<omgdc:Bounds[^>]*y="(\d+)"/
  );
  assert.ok(normalNextMatch && errHandlerMatch);
  const mainNextY = Number(normalNextMatch[1]);
  const excY = Number(errHandlerMatch[1]);
  assert.ok(excY > mainNextY, `Expected boundary target (y=${excY}) below main target (y=${mainNextY})`);

  const errBottomY = Number(errMatch[2]) + Number(errMatch[4]);
  const errEdgeMatch = layouted.match(
    /id="FB_Err_di"[^>]*>[\s\S]*?<omgdi:waypoint x="(\d+)" y="(\d+)"/
  );
  assert.ok(errEdgeMatch, 'Boundary outgoing edge must have DI waypoints');
  assert.equal(Number(errEdgeMatch[2]), errBottomY);
});

test('validateAndLayoutBpmn handles BoundaryEvent in a simple process without Pools or Lanes', async () => {
  const simpleBoundaryXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_SimpleBnd" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Simple" isExecutable="false">
    <bpmn:startEvent id="S_S" name="Inicio"><bpmn:outgoing>FS_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T_API" name="Consultar API"><bpmn:incoming>FS_1</bpmn:incoming><bpmn:outgoing>FS_2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:boundaryEvent id="B_Timeout" name="Timeout" attachedToRef="T_API"><bpmn:outgoing>FS_Timeout</bpmn:outgoing><bpmn:timerEventDefinition id="TD_S" /></bpmn:boundaryEvent>
    <bpmn:endEvent id="E_Ok" name="Completado"><bpmn:incoming>FS_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E_Fail" name="Fallido"><bpmn:incoming>FS_Timeout</bpmn:incoming><bpmn:errorEventDefinition id="ED_S" /></bpmn:endEvent>
    <bpmn:sequenceFlow id="FS_1" sourceRef="S_S" targetRef="T_API" />
    <bpmn:sequenceFlow id="FS_2" sourceRef="T_API" targetRef="E_Ok" />
    <bpmn:sequenceFlow id="FS_Timeout" sourceRef="B_Timeout" targetRef="E_Fail" />
  </bpmn:process>
</bpmn:definitions>`;

  const layouted = await validateAndLayoutBpmn(simpleBoundaryXml);
  assert.ok(layouted.includes('bpmnElement="Process_Simple"'));
  assert.ok(layouted.includes('id="B_Timeout_di"'));
  assert.ok(layouted.includes('id="FS_Timeout_di"'));
});

test('validateAndLayoutBpmn rejects BoundaryEvent with invalid attachedToRef or incoming sequenceFlow', async () => {
  const badHostXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_BadHost" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_BadHost" isExecutable="false">
    <bpmn:startEvent id="S_1" name="Inicio"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:boundaryEvent id="B_1" name="Error" attachedToRef="S_1"><bpmn:outgoing>F2</bpmn:outgoing><bpmn:errorEventDefinition id="E_D" /></bpmn:boundaryEvent>
    <bpmn:endEvent id="E_1" name="Fin"><bpmn:incoming>F1</bpmn:incoming><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S_1" targetRef="E_1" />
    <bpmn:sequenceFlow id="F2" sourceRef="B_1" targetRef="E_1" />
  </bpmn:process>
</bpmn:definitions>`;
  await assert.rejects(() => validateAndLayoutBpmn(badHostXml), BpmnValidationError);

  const incomingBoundaryXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_InBnd" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_InBnd" isExecutable="false">
    <bpmn:startEvent id="S_1" name="Inicio"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T_1" name="Revisar"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F_Bad</bpmn:outgoing></bpmn:task>
    <bpmn:boundaryEvent id="B_1" name="Error" attachedToRef="T_1"><bpmn:incoming>F_Bad</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing><bpmn:errorEventDefinition id="E_D" /></bpmn:boundaryEvent>
    <bpmn:endEvent id="E_1" name="Fin"><bpmn:incoming>F2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S_1" targetRef="T_1" />
    <bpmn:sequenceFlow id="F_Bad" sourceRef="T_1" targetRef="B_1" />
    <bpmn:sequenceFlow id="F2" sourceRef="B_1" targetRef="E_1" />
  </bpmn:process>
</bpmn:definitions>`;
  await assert.rejects(() => validateAndLayoutBpmn(incomingBoundaryXml), BpmnValidationError);
});

test('validateAndLayoutBpmn preserves activity loop/multi-instance markers, specialized task types, inclusiveGateway, and default sequenceFlow', async () => {
  const richActivitiesXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_Rich" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Rich" isExecutable="false">
    <bpmn:startEvent id="S_R" name="Inicio"><bpmn:outgoing>FR_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:businessRuleTask id="T_Rule" name="Evaluar scoring"><bpmn:incoming>FR_1</bpmn:incoming><bpmn:outgoing>FR_2</bpmn:outgoing><bpmn:standardLoopCharacteristics id="Loop_1" /></bpmn:businessRuleTask>
    <bpmn:inclusiveGateway id="Gw_IncSplit" name="Canales aplicables" default="FR_Default"><bpmn:incoming>FR_2</bpmn:incoming><bpmn:outgoing>FR_Man</bpmn:outgoing><bpmn:outgoing>FR_Default</bpmn:outgoing></bpmn:inclusiveGateway>
    <bpmn:manualTask id="T_Manual" name="Preparar paquetes"><bpmn:incoming>FR_Man</bpmn:incoming><bpmn:outgoing>FR_3</bpmn:outgoing><bpmn:multiInstanceLoopCharacteristics id="MI_Par" /></bpmn:manualTask>
    <bpmn:scriptTask id="T_Script" name="Procesar lotes"><bpmn:incoming>FR_Default</bpmn:incoming><bpmn:outgoing>FR_4</bpmn:outgoing><bpmn:multiInstanceLoopCharacteristics id="MI_Seq" isSequential="true" /></bpmn:scriptTask>
    <bpmn:inclusiveGateway id="Gw_IncJoin"><bpmn:incoming>FR_3</bpmn:incoming><bpmn:incoming>FR_4</bpmn:incoming><bpmn:outgoing>FR_5</bpmn:outgoing></bpmn:inclusiveGateway>
    <bpmn:endEvent id="E_Msg" name="Notificar cierre"><bpmn:incoming>FR_5</bpmn:incoming><bpmn:messageEventDefinition id="MsgEnd_1" /></bpmn:endEvent>
    <bpmn:sequenceFlow id="FR_1" sourceRef="S_R" targetRef="T_Rule" />
    <bpmn:sequenceFlow id="FR_2" sourceRef="T_Rule" targetRef="Gw_IncSplit" />
    <bpmn:sequenceFlow id="FR_Man" name="Requiere envío" sourceRef="Gw_IncSplit" targetRef="T_Manual" />
    <bpmn:sequenceFlow id="FR_Default" name="Por defecto" sourceRef="Gw_IncSplit" targetRef="T_Script" />
    <bpmn:sequenceFlow id="FR_3" sourceRef="T_Manual" targetRef="Gw_IncJoin" />
    <bpmn:sequenceFlow id="FR_4" sourceRef="T_Script" targetRef="Gw_IncJoin" />
    <bpmn:sequenceFlow id="FR_5" sourceRef="Gw_IncJoin" targetRef="E_Msg" />
  </bpmn:process>
</bpmn:definitions>`;

  const layouted = await validateAndLayoutBpmn(richActivitiesXml);
  assert.ok(layouted.includes('BPMNDiagram'));
  assert.ok(layouted.includes('<bpmn:standardLoopCharacteristics'));
  assert.ok(layouted.includes('<bpmn:multiInstanceLoopCharacteristics id="MI_Par"'));
  assert.ok(layouted.includes('isSequential="true"'));
  assert.ok(layouted.includes('<bpmn:businessRuleTask'));
  assert.ok(layouted.includes('<bpmn:manualTask'));
  assert.ok(layouted.includes('<bpmn:scriptTask'));
  assert.ok(layouted.includes('default="FR_Default"'));
  assert.ok(layouted.includes('<bpmn:messageEventDefinition id="MsgEnd_1"'));
});

test('validateAndLayoutBpmn uses distinct gateway ports so default flow never overlaps sibling branches', async () => {
  const gatewayPortsXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_GwPorts" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_Gw">
    <bpmn:participant id="Part_Gw" name="Empresa" processRef="Proc_Gw" />
  </bpmn:collaboration>
  <bpmn:process id="Proc_Gw" isExecutable="false">
    <bpmn:laneSet id="LS_Gw">
      <bpmn:lane id="Lane_Gw" name="Operaciones">
        <bpmn:flowNodeRef>S_Gw</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gw_Ex</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T_Si</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T_No</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gw_Inc</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T_Inc1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T_Inc2</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T_Inc3</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>E_Gw</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S_Gw" name="Inicio"><bpmn:outgoing>FG_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Gw_Ex" name="¿Cumple?" default="FG_Si"><bpmn:incoming>FG_1</bpmn:incoming><bpmn:outgoing>FG_Si</bpmn:outgoing><bpmn:outgoing>FG_No</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:task id="T_Si" name="Aprobar"><bpmn:incoming>FG_Si</bpmn:incoming><bpmn:outgoing>FG_2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="T_No" name="Rechazar"><bpmn:incoming>FG_No</bpmn:incoming></bpmn:endEvent>
    <bpmn:inclusiveGateway id="Gw_Inc" name="Canales" default="FG_Inc3"><bpmn:incoming>FG_2</bpmn:incoming><bpmn:outgoing>FG_Inc1</bpmn:outgoing><bpmn:outgoing>FG_Inc2</bpmn:outgoing><bpmn:outgoing>FG_Inc3</bpmn:outgoing></bpmn:inclusiveGateway>
    <bpmn:task id="T_Inc1" name="Inspeccionar"><bpmn:incoming>FG_Inc1</bpmn:incoming><bpmn:outgoing>FG_J1</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T_Inc2" name="Registrar"><bpmn:incoming>FG_Inc2</bpmn:incoming><bpmn:outgoing>FG_J2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T_Inc3" name="Archivar"><bpmn:incoming>FG_Inc3</bpmn:incoming><bpmn:outgoing>FG_J3</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E_Gw" name="Fin"><bpmn:incoming>FG_J1</bpmn:incoming><bpmn:incoming>FG_J2</bpmn:incoming><bpmn:incoming>FG_J3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="FG_1" sourceRef="S_Gw" targetRef="Gw_Ex" />
    <bpmn:sequenceFlow id="FG_Si" name="Sí" sourceRef="Gw_Ex" targetRef="T_Si" />
    <bpmn:sequenceFlow id="FG_No" name="No" sourceRef="Gw_Ex" targetRef="T_No" />
    <bpmn:sequenceFlow id="FG_2" sourceRef="T_Si" targetRef="Gw_Inc" />
    <bpmn:sequenceFlow id="FG_Inc1" sourceRef="Gw_Inc" targetRef="T_Inc1" />
    <bpmn:sequenceFlow id="FG_Inc2" sourceRef="Gw_Inc" targetRef="T_Inc2" />
    <bpmn:sequenceFlow id="FG_Inc3" sourceRef="Gw_Inc" targetRef="T_Inc3" />
    <bpmn:sequenceFlow id="FG_J1" sourceRef="T_Inc1" targetRef="E_Gw" />
    <bpmn:sequenceFlow id="FG_J2" sourceRef="T_Inc2" targetRef="E_Gw" />
    <bpmn:sequenceFlow id="FG_J3" sourceRef="T_Inc3" targetRef="E_Gw" />
  </bpmn:process>
</bpmn:definitions>`;

  const layouted = await validateAndLayoutBpmn(gatewayPortsXml);
  const firstWp = (edgeId: string): string => {
    const m = layouted.match(
      new RegExp(`id="${edgeId}_di"[^>]*>[\\s\\S]*?<omgdi:waypoint x="(\\d+)" y="(\\d+)"`)
    );
    assert.ok(m, `Expected waypoints for ${edgeId}`);
    return `${m[1]},${m[2]}`;
  };

  assert.notEqual(
    firstWp('FG_Si'),
    firstWp('FG_No'),
    'Default flow FG_Si and sibling FG_No must start from distinct gateway vertices'
  );

  const incStarts = [firstWp('FG_Inc1'), firstWp('FG_Inc2'), firstWp('FG_Inc3')];
  assert.equal(
    new Set(incStarts).size,
    3,
    `Expected 3 distinct start ports for InclusiveGateway, got ${incStarts.join(' | ')}`
  );
});

test('validateAndLayoutBpmn routes MessageFlow around intermediate task obstacles', async () => {
  const obstacleMsgXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_Obs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_Obs">
    <bpmn:participant id="Part_Main" name="Empresa" processRef="Proc_Obs" />
    <bpmn:participant id="Part_Ext" name="Proveedor" />
    <bpmn:messageFlow id="MF_Order" name="Orden" sourceRef="Task_SendOrder" targetRef="Part_Ext" />
  </bpmn:collaboration>
  <bpmn:process id="Proc_Obs" isExecutable="false">
    <bpmn:laneSet id="LS_Obs">
      <bpmn:lane id="Lane_Top" name="Compras">
        <bpmn:flowNodeRef>S_Obs</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_SendOrder</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Mid" name="Finanzas">
        <bpmn:flowNodeRef>Task_MiddleObstacle</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>E_Obs</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S_Obs" name="Inicio"><bpmn:outgoing>FO_1</bpmn:outgoing><bpmn:outgoing>FO_2</bpmn:outgoing></bpmn:startEvent>
    <bpmn:sendTask id="Task_SendOrder" name="Enviar orden"><bpmn:incoming>FO_1</bpmn:incoming><bpmn:outgoing>FO_3</bpmn:outgoing></bpmn:sendTask>
    <bpmn:task id="Task_MiddleObstacle" name="Enviar recordatorio"><bpmn:incoming>FO_2</bpmn:incoming><bpmn:outgoing>FO_4</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="E_Obs" name="Fin"><bpmn:incoming>FO_3</bpmn:incoming><bpmn:incoming>FO_4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="FO_1" sourceRef="S_Obs" targetRef="Task_SendOrder" />
    <bpmn:sequenceFlow id="FO_2" sourceRef="S_Obs" targetRef="Task_MiddleObstacle" />
    <bpmn:sequenceFlow id="FO_3" sourceRef="Task_SendOrder" targetRef="E_Obs" />
    <bpmn:sequenceFlow id="FO_4" sourceRef="Task_MiddleObstacle" targetRef="E_Obs" />
  </bpmn:process>
</bpmn:definitions>`;

  const layouted = await validateAndLayoutBpmn(obstacleMsgXml);
  const obsMatch = layouted.match(
    /id="Task_MiddleObstacle_di"[^>]*>[\s\S]*?<omgdc:Bounds x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/
  );
  const mfEdgeMatch = layouted.match(/id="MF_Order_di"[^>]*>([\s\S]*?)<\/bpmndi:BPMNEdge>/);
  assert.ok(obsMatch && mfEdgeMatch, 'Middle obstacle bounds and MF_Order edge must exist');

  const obsBox = {
    x: Number(obsMatch[1]),
    y: Number(obsMatch[2]),
    w: Number(obsMatch[3]),
    h: Number(obsMatch[4]),
  };
  const wps = Array.from(mfEdgeMatch[1].matchAll(/x="(-?\d+)" y="(-?\d+)"/g)).map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  assert.ok(wps.length >= 3, 'Expected obstacle-avoiding orthogonal detour for MF_Order');

  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    if (a.x === b.x) {
      const segMinY = Math.min(a.y, b.y);
      const segMaxY = Math.max(a.y, b.y);
      const crossesVertically = segMinY < obsBox.y + obsBox.h && segMaxY > obsBox.y;
      const insideHorizontally = a.x >= obsBox.x && a.x <= obsBox.x + obsBox.w;
      assert.ok(
        !(crossesVertically && insideHorizontally),
        `MessageFlow segment at x=${a.x} must not cross inside middle task (${obsBox.x}..${obsBox.x + obsBox.w})`
      );
    }
  }
});

test('separateOverlappingEdges separates overlapping vertical segments in inter-column corridors', () => {
  const inputXml = `<bpmndi:BPMNDiagram id="D1"><bpmndi:BPMNPlane id="P1">
    <bpmndi:BPMNEdge id="Edge_1_di" bpmnElement="Edge_1">
      <omgdi:waypoint x="200" y="100" />
      <omgdi:waypoint x="300" y="100" />
      <omgdi:waypoint x="300" y="300" />
      <omgdi:waypoint x="400" y="300" />
    </bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="Edge_2_di" bpmnElement="Edge_2">
      <omgdi:waypoint x="200" y="140" />
      <omgdi:waypoint x="300" y="140" />
      <omgdi:waypoint x="300" y="340" />
      <omgdi:waypoint x="400" y="340" />
    </bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`;

  const output = separateOverlappingEdges(inputXml);
  const edges = Array.from(output.matchAll(/<bpmndi:BPMNEdge[\s\S]*?<\/bpmndi:BPMNEdge>/g));
  assert.equal(edges.length, 2);

  const wps1 = Array.from(edges[0][0].matchAll(/x="(-?\d+)" y="(-?\d+)"/g)).map((m) => Number(m[1]));
  const wps2 = Array.from(edges[1][0].matchAll(/x="(-?\d+)" y="(-?\d+)"/g)).map((m) => Number(m[1]));
  assert.equal(wps1[0], 200);
  assert.equal(wps1[3], 400);
  assert.equal(wps2[0], 200);
  assert.equal(wps2[3], 400);
  assert.notEqual(wps1[1], wps2[1], 'Overlapping vertical corridors must be separated');
});

test('estimateCostUsd computes official pricing for gemini-4-hydrogen global/regional and gemini-2.5-flash', () => {
  const v3Usage = { promptTokens: 2442, outputTokens: 4309, thinkingTokens: 8521 };
  assert.equal(estimateCostUsd(v3Usage, 'gemini-4-hydrogen', 'global'), 0.099888);
  assert.equal(estimateCostUsd(v3Usage, 'gemini-4-hydrogen', 'us-central1'), 0.109877);
  assert.equal(estimateCostUsd(v3Usage, 'gemini-2.5-flash', 'global'), 0.032808);
  assert.equal(estimateCostUsd(v3Usage, 'unknown-model-x', 'global'), undefined);
});

test('validateAndLayoutBpmn routes downward gateway flow around sibling node in same column', async () => {
  const gatewayObstacleXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_GwObs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:collaboration id="Collab_GwObs">
    <bpmn:participant id="Part_Emp" name="Empresa" processRef="Proc_GwObs" />
  </bpmn:collaboration>
  <bpmn:process id="Proc_GwObs" isExecutable="false">
    <bpmn:laneSet id="LS_GwObs">
      <bpmn:lane id="Lane_Fin" name="Finanzas">
        <bpmn:flowNodeRef>S_G</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_API</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Boundary_Err</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gw_Inc</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_Err</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T_Top</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T_Mid</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Log" name="Logística">
        <bpmn:flowNodeRef>T_Bottom</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>E_Done</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S_G" name="Inicio"><bpmn:outgoing>F_Start</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="Task_API" name="Ejecutar transferencia"><bpmn:incoming>F_Start</bpmn:incoming><bpmn:outgoing>F_Ok</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:boundaryEvent id="Boundary_Err" name="Error técnico" attachedToRef="Task_API"><bpmn:outgoing>F_Err</bpmn:outgoing><bpmn:errorEventDefinition id="ED_G" /></bpmn:boundaryEvent>
    <bpmn:endEvent id="End_Err" name="Error de pago"><bpmn:incoming>F_Err</bpmn:incoming><bpmn:errorEventDefinition id="ED_End" /></bpmn:endEvent>
    <bpmn:inclusiveGateway id="Gw_Inc" name="¿Qué acciones aplican?" default="F_Mid"><bpmn:incoming>F_Ok</bpmn:incoming><bpmn:outgoing>F_Top</bpmn:outgoing><bpmn:outgoing>F_Mid</bpmn:outgoing><bpmn:outgoing>F_Bot</bpmn:outgoing></bpmn:inclusiveGateway>
    <bpmn:scriptTask id="T_Top" name="Registrar facturas"><bpmn:incoming>F_Top</bpmn:incoming><bpmn:outgoing>F_J1</bpmn:outgoing></bpmn:scriptTask>
    <bpmn:task id="T_Mid" name="Archivar comprobante"><bpmn:incoming>F_Mid</bpmn:incoming><bpmn:outgoing>F_J2</bpmn:outgoing></bpmn:task>
    <bpmn:manualTask id="T_Bottom" name="Inspeccionar bultos"><bpmn:incoming>F_Bot</bpmn:incoming><bpmn:outgoing>F_J3</bpmn:outgoing></bpmn:manualTask>
    <bpmn:endEvent id="E_Done" name="Fin"><bpmn:incoming>F_J1</bpmn:incoming><bpmn:incoming>F_J2</bpmn:incoming><bpmn:incoming>F_J3</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F_Start" sourceRef="S_G" targetRef="Task_API" />
    <bpmn:sequenceFlow id="F_Ok" sourceRef="Task_API" targetRef="Gw_Inc" />
    <bpmn:sequenceFlow id="F_Err" sourceRef="Boundary_Err" targetRef="End_Err" />
    <bpmn:sequenceFlow id="F_Top" sourceRef="Gw_Inc" targetRef="T_Top" />
    <bpmn:sequenceFlow id="F_Mid" name="Por defecto" sourceRef="Gw_Inc" targetRef="T_Mid" />
    <bpmn:sequenceFlow id="F_Bot" sourceRef="Gw_Inc" targetRef="T_Bottom" />
    <bpmn:sequenceFlow id="F_J1" sourceRef="T_Top" targetRef="E_Done" />
    <bpmn:sequenceFlow id="F_J2" sourceRef="T_Mid" targetRef="E_Done" />
    <bpmn:sequenceFlow id="F_J3" sourceRef="T_Bottom" targetRef="E_Done" />
  </bpmn:process>
</bpmn:definitions>`;

  const layouted = await validateAndLayoutBpmn(gatewayObstacleXml);
  const errMatch = layouted.match(
    /id="End_Err_di"[^>]*>[\s\S]*?<omgdc:Bounds x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/
  );
  const botEdgeMatch = layouted.match(/id="F_Bot_di"[^>]*>([\s\S]*?)<\/bpmndi:BPMNEdge>/);
  assert.ok(errMatch && botEdgeMatch, 'End_Err bounds and F_Bot edge must exist');

  const errBox = {
    x: Number(errMatch[1]),
    y: Number(errMatch[2]),
    w: Number(errMatch[3]),
    h: Number(errMatch[4]),
  };
  const wps = Array.from(botEdgeMatch[1].matchAll(/x="(-?\d+)" y="(-?\d+)"/g)).map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
  }));
  assert.ok(wps.length >= 4, 'Expected bypass detour around sibling End_Err node');

  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    if (a.x === b.x) {
      const segMinY = Math.min(a.y, b.y);
      const segMaxY = Math.max(a.y, b.y);
      const crossesVertically = segMinY < errBox.y + errBox.h && segMaxY > errBox.y;
      const insideHorizontally = a.x >= errBox.x && a.x <= errBox.x + errBox.w;
      assert.ok(
        !(crossesVertically && insideHorizontally),
        `F_Bot segment at x=${a.x} must not cross inside End_Err (${errBox.x}..${errBox.x + errBox.w})`
      );
    }
  }
});
