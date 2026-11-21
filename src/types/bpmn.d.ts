declare module 'bpmn-auto-layout' {
  export function layoutProcess(xml: string): Promise<string>;
}

declare module 'bpmn-moddle' {
  export default class BpmnModdle {
    fromXML(xml: string): Promise<{
      rootElement: unknown;
      warnings: unknown[];
    }>;
  }
}
