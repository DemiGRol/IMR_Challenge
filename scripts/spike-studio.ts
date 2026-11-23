import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { layoutProcess } from 'bpmn-auto-layout';
import BpmnModdle from 'bpmn-moddle';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_STUDIO_MODEL || 'gemini-4-hydrogen';
  if (!apiKey) throw new Error('Falta GEMINI_API_KEY en .env.local');

  const ai = new GoogleGenAI({ apiKey });
  const prompt =
    'El cliente envía un pedido. El sistema verifica si hay stock. Si hay stock, se prepara el envío y se emite la factura en paralelo, y luego se cierra el pedido. Si no hay stock, se notifica el rechazo y finaliza el proceso.';

  const t0 = performance.now();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      systemInstruction:
        'Devolvé un JSON con "bpmnXml" (BPMN 2.0 XML semántico válido con <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn"> y un único <bpmn:process id="Process_1" isExecutable="false">, sin bpmndi:BPMNDiagram) y "assumptions" (array de objetos { question, assumption, elementIds, sourceExcerpt }).',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          bpmnXml: { type: Type.STRING },
          assumptions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                assumption: { type: Type.STRING },
                elementIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                sourceExcerpt: { type: Type.STRING },
              },
              required: ['question', 'assumption', 'elementIds', 'sourceExcerpt'],
            },
          },
        },
        required: ['bpmnXml', 'assumptions'],
      },
      temperature: 0.2,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = response.text?.trim();
  if (!text) throw new Error('Respuesta vacía de Google AI Studio');

  const parsed = JSON.parse(text) as { bpmnXml: string; assumptions: unknown[] };
  const moddle = new BpmnModdle();
  const { warnings } = await moddle.fromXML(parsed.bpmnXml);
  const layouted = await layoutProcess(parsed.bpmnXml);
  const hasDi = layouted.includes('BPMNDiagram') && layouted.includes('BPMNPlane');
  const ms = Math.round(performance.now() - t0);

  console.log(
    `Google AI Studio OK (${model}, ${ms}ms). moddleWarnings=${warnings.length}, hasDI=${hasDi}, assumptions=${parsed.assumptions.length}, usage=`,
    response.usageMetadata
  );
  if (!hasDi) process.exit(1);
}

main().catch((err) => {
  console.error('Google AI Studio spike failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
