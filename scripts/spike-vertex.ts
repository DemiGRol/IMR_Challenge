import { GoogleGenAI, Type } from '@google/genai';
import { layoutProcess } from 'bpmn-auto-layout';
import BpmnModdle from 'bpmn-moddle';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

function parseServiceAccount(raw: string | undefined): Record<string, unknown> {
  if (!raw) throw new Error('Falta GCP_SERVICE_ACCOUNT_JSON en .env.local');
  const trimmed = raw.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');
  return JSON.parse(jsonText);
}

async function main() {
  const project = process.env.GCP_PROJECT_ID;
  const location = process.env.GCP_LOCATION || 'us-central1';
  const model = process.env.VERTEX_MODEL || 'gemini-2.5-flash';
  if (!project) throw new Error('Falta GCP_PROJECT_ID en .env.local');

  const credentials = parseServiceAccount(process.env.GCP_SERVICE_ACCOUNT_JSON);

  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    googleAuthOptions: { credentials },
  });

  const prompt =
    'El cliente envía un pedido. El sistema verifica si hay stock. Si hay stock, se prepara el envío y se emite la factura en paralelo, y luego se cierra el pedido. Si no hay stock, se notifica el rechazo y finaliza el proceso.';

  const t0 = performance.now();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction:
        'Sos un experto en BPMN 2.0. Devolvé un JSON con "bpmnXml" (un documento BPMN 2.0 XML semántico válido con <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn"> y un único <bpmn:process isExecutable="false">, usando solo startEvent, endEvent, task, userTask, serviceTask, exclusiveGateway, parallelGateway y sequenceFlow, con incoming/outgoing consistentes y SIN bloque bpmndi:BPMNDiagram) y "assumptions" (array de strings en español con los supuestos asumidos ante ambigüedades).',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          bpmnXml: { type: Type.STRING },
          assumptions: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['bpmnXml', 'assumptions'],
      },
      temperature: 0.2,
    },
  });

  const llmMs = Math.round(performance.now() - t0);
  const text = response.text;
  if (!text) throw new Error('Respuesta vacía de Vertex AI');

  const parsed = JSON.parse(text) as { bpmnXml: string; assumptions: string[] };
  console.log(`Vertex AI OK (${model}, ${llmMs}ms). Assumptions:`, parsed.assumptions);

  const moddle = new BpmnModdle();
  const { warnings } = await moddle.fromXML(parsed.bpmnXml);
  const layouted = await layoutProcess(parsed.bpmnXml);
  const hasDi = layouted.includes('BPMNDiagram') && layouted.includes('BPMNPlane');

  console.log(`Pipeline BPMN: moddleWarnings=${warnings.length}, hasDI=${hasDi}, xmlLength=${layouted.length}`);
  if (!hasDi) process.exit(1);
}

main().catch((err) => {
  console.error('Vertex spike failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
