import { Catalog, Category, City, Order, Region, Service, ServiceKey } from "./types";

// Услуги по умолчанию. Используются как запасной вариант (offline) и как
// исходный реестр для отрисовки иконок/цветов до загрузки справочника с сервера.
// Должны совпадать с server/seed.js.
const defaultServices: Service[] = [
  { key: "water", title: "Водовоз", subtitle: "Питьевая и тех. вода", icon: "tanker-truck", accent: "#1683A7", category: "transport" },
  { key: "dump", title: "КамАЗ", subtitle: "Песок, щебень, вывоз", icon: "dump-truck", accent: "#C1642E", category: "transport" },
  { key: "transport", title: "Перевозки", subtitle: "Грузовики, фургоны", icon: "truck", accent: "#556B8C", category: "transport" },
  { key: "loader", title: "Грузчики", subtitle: "Погрузка и выгрузка", icon: "dolly", accent: "#84763A", category: "transport" },
  { key: "crane", title: "Манипулятор", subtitle: "Погрузка и доставка", icon: "crane", accent: "#7354A8", category: "equipment" },
  { key: "tractor", title: "Спецтехника", subtitle: "Трактор, экскаватор", icon: "excavator", accent: "#B8942E", category: "equipment" },
  { key: "septic", title: "Ассенизатор", subtitle: "Септик, выгребная яма", icon: "truck-cargo-container", accent: "#6E7C45", category: "utilities" },
  { key: "plumber", title: "Сантехник", subtitle: "Монтаж и ремонт", icon: "pipe-wrench", accent: "#2E7D5B", category: "utilities" },
  { key: "electrician", title: "Электрик", subtitle: "Монтаж и ремонт сети", icon: "flash", accent: "#D98A00", category: "electric" },
  { key: "welder", title: "Сварщик", subtitle: "Металлоконструкции", icon: "fire", accent: "#C7503A", category: "electric" },
  { key: "lowvoltage", title: "Слаботочник", subtitle: "Сети, видеонаблюдение", icon: "ethernet-cable", accent: "#0E8A9C", category: "electric" }
];

const defaultCategories: Category[] = [
  { key: "transport", title: "Доставка и вывоз" },
  { key: "equipment", title: "Спецтехника" },
  { key: "utilities", title: "Сантехника и вода" },
  { key: "electric", title: "Электрика и монтаж" }
];

const allServiceKeys = defaultServices.map((s) => s.key);

const fallbackCities: City[] = [
  {
    id: "yakutsk",
    regionId: "sakha",
    name: "Якутск",
    region: "Республика Саха (Якутия)",
    center: [129.732178, 62.027833],
    zoom: 12,
    services: allServiceKeys
  },
  {
    id: "kazan",
    regionId: "tatarstan",
    name: "Казань",
    region: "Татарстан",
    center: [49.106414, 55.796127],
    zoom: 11,
    services: allServiceKeys
  },
  {
    id: "novosibirsk",
    regionId: "novosibirsk_obl",
    name: "Новосибирск",
    region: "Новосибирская область",
    center: [82.92043, 55.030204],
    zoom: 11,
    services: ["water", "septic", "dump", "tractor", "transport", "electrician", "plumber"]
  }
];

const fallbackRegions: Region[] = [
  { id: "sakha", name: "Республика Саха (Якутия)", cities: [fallbackCities[0]] },
  { id: "tatarstan", name: "Татарстан", cities: [fallbackCities[1]] },
  { id: "novosibirsk_obl", name: "Новосибирская область", cities: [fallbackCities[2]] }
];

export const fallbackCatalog: Catalog = {
  regions: fallbackRegions,
  cities: fallbackCities,
  services: defaultServices,
  categories: defaultCategories
};

// Запасные заказы (когда сервер недоступен).
export const initialOrders: Order[] = [
  {
    id: "1428",
    cityId: "yakutsk",
    service: "water",
    from: "Якутск, район Сайсары",
    details: "Нужно 5 кубов технической воды сегодня до 18:00",
    price: 4200,
    distance: "8 км",
    status: "open",
    coordinates: [129.7058, 62.0162],
    customerName: "Айаал",
    bids: [
      { id: "b1", driver: "Вода Якутск", price: 4500, eta: "45 мин", rating: 4.9 },
      { id: "b2", driver: "Север Водовоз", price: 4300, eta: "1 ч 10 мин", rating: 4.7 }
    ]
  },
  {
    id: "1429",
    cityId: "yakutsk",
    service: "septic",
    from: "Якутск, Табага, дачный участок",
    details: "Откачать септик 4 куба, подъезд узкий",
    price: 3600,
    distance: "19 км",
    status: "open",
    coordinates: [129.6225, 61.8627],
    customerName: "Мария",
    bids: [{ id: "b3", driver: "Ассенизатор 14", price: 3900, eta: "50 мин", rating: 4.8 }]
  },
  {
    id: "1430",
    cityId: "yakutsk",
    service: "crane",
    from: "Якутск, промзона Марха",
    details: "Перевезти бытовку, нужен манипулятор 5 т",
    price: 12000,
    distance: "14 км",
    status: "matched",
    coordinates: [129.6534, 62.0814],
    customerName: "Семен",
    bids: [{ id: "b4", driver: "Манипулятор Якутск", price: 12500, eta: "завтра 9:00", rating: 5 }]
  }
];

// --- Реестр услуг -----------------------------------------------------------
// Метаданные услуг (иконка, цвет, название) нужны в карточках и на карте, где
// прокидывать их пропсами неудобно. Держим живой реестр, который App обновляет
// данными с сервера сразу после загрузки справочника.

let serviceRegistry: Service[] = [...defaultServices];

export function setServiceRegistry(services: Service[]) {
  if (services.length) {
    serviceRegistry = services;
  }
}

export function serviceByKey(key: ServiceKey): Service {
  return serviceRegistry.find((service) => service.key === key) ?? serviceRegistry[0];
}
