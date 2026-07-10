// Схемы ТТХ по категориям. Единый источник — server/equipmentSpecs.json
// (сервер валидирует по нему же). Здесь — типы и хелперы отображения.
import type { ServiceKey } from "./types";
import raw from "../server/equipmentSpecs.json";

export type SpecFieldType = "number" | "text" | "select" | "bool";

export type SpecField = {
  key: string;
  label: string;
  unit?: string;
  type: SpecFieldType;
  options?: string[];
  required?: boolean;
  max?: number;
};

export type EquipmentSchema = {
  label: string;
  unitWord: string;
  fields: SpecField[];
};

const schemas = raw as unknown as Record<string, EquipmentSchema>;

export function equipmentSchema(serviceKey: ServiceKey): EquipmentSchema | null {
  return schemas[serviceKey] ?? null;
}

export function hasEquipmentSchema(serviceKey: ServiceKey): boolean {
  return Boolean(schemas[serviceKey]);
}

type SpecValue = string | number | boolean;

// Короткая сводка для карточки: «7 т · стрела 12 м · утеплённая».
export function summarizeSpecs(serviceKey: ServiceKey, values: Record<string, SpecValue>): string {
  const schema = schemas[serviceKey];
  if (!schema) {
    return "";
  }
  const parts: string[] = [];
  for (const f of schema.fields) {
    const v = values[f.key];
    if (v === undefined || v === null || v === "") {
      continue;
    }
    if (f.type === "bool") {
      if (v) {
        parts.push(f.label.toLowerCase());
      }
    } else if (f.type === "number") {
      parts.push(`${v}${f.unit ? ` ${f.unit}` : ""}`);
    } else {
      parts.push(String(v));
    }
  }
  return parts.join(" · ");
}
