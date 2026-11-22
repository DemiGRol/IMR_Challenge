import { layoutProcess } from 'bpmn-auto-layout';
import BpmnModdle from 'bpmn-moddle';
import { existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  process.loadEnvFile('.env.local');
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
  if (!apiKey) throw new Error('Falta GROQ_API_KEY en .env.local');

  const prompt =
    'El cliente envía un pedido. El sistema verifica si hay stock. Si hay stock, se prepara el envío y se emite la factura en paralelo, y luego se cierra el pedido. Si no hay stock, se notifica el rechazo y finaliza el proceso.';

  const t0 = performance.now();
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Devolvé un JSON con "bpmnXml" (BPMN 2.0 XML semántico válido con <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn"> y un único <bpmn:process id="Process_1" isExecutable="false">, sin bpmndi:BPMNDiagram) y "assumptions" (array de objetos { question, assumption, elementIds, sourceExcerpt }).',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: Record<string, number>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data.error?.message || 'Error Groq'}`);

  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('Respuesta vacía de Groq');

  const parsed = JSON.parse(text) as { bpmnXml: string; assumptions: unknown[] };
  const moddle = new BpmnModdle();
  const { warnings } = await moddle.fromXML(parsed.bpmnXml);
  const layouted = await layoutProcess(parsed.bpmnXml);
  const hasDi = layouted.includes('BPMNDiagram') && layouted.includes('BPMNPlane');
  const ms = Math.round(performance.now() - t0);

  console.log(
    `Groq OK (${model}, ${ms}ms). moddleWarnings=${warnings.length}, hasDI=${hasDi}, assumptions=${parsed.assumptions?.length ?? 0}, usage=`,
    data.usage
  );
  if (!hasDi) process.exit(1);
}

main().catch((err) => {
  console.error('Groq spike failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
