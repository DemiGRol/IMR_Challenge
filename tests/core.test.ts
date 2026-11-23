import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateAndLayoutBpmn,
  BpmnValidationError,
  compactBpmnForPrompt,
} from '../src/lib/bpmn/validator.ts';
import { separateOverlappingEdges } from '../src/lib/bpmn/layout-postprocess.ts';
import { buildCacheKey, getCachedBpmn, setCachedBpmn } from '../src/lib/cache.ts';
import { checkRateLimit } from '../src/lib/rate-limit.ts';

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
