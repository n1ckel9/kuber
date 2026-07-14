import { Catalog, Category, City, Order, Region, Service, ServiceKey } from "./types";

// Услуги по умолчанию. Используются как запасной вариант (offline) и как
// исходный реестр для отрисовки иконок/цветов до загрузки справочника с сервера.
// Должны совпадать с server/seed.js.
// Представительный набор (не все 35 услуг) — только для offline/первой отрисовки,
// полный справочник приходит с сервера и заменяет реестр. Ключи и категории
// должны совпадать с server/seed.js.
const defaultServices: Service[] = [
  { key: "crane", title: "Манипуляторы", subtitle: "Погрузка и доставка", icon: "crane", accent: "#7354A8", category: "tech" },
  { key: "dump", title: "Самосвалы", subtitle: "Песок, щебень, вывоз", icon: "dump-truck", accent: "#C1642E", category: "tech" },
  { key: "excavator", title: "Экскаваторы", subtitle: "Копка, траншеи", icon: "excavator", accent: "#B8942E", category: "tech" },
  { key: "water", title: "Водовозки", subtitle: "Питьевая и тех. вода", icon: "tanker-truck", accent: "#1683A7", category: "tech" },
  { key: "septic", title: "Ассенизаторы", subtitle: "Откачка септиков и ям", icon: "truck-cargo-container", accent: "#6E7C45", category: "tech" },
  { key: "electrician", title: "Электрики", subtitle: "Монтаж и ремонт сети", icon: "flash", accent: "#D98A00", category: "specialists" },
  { key: "plumber", title: "Сантехники", subtitle: "Монтаж и ремонт", icon: "pipe-wrench", accent: "#2E7D5B", category: "specialists" },
  { key: "welder", title: "Сварщики", subtitle: "Металлоконструкции, НАКС", icon: "fire", accent: "#C7503A", category: "specialists" },
  { key: "loader", title: "Грузчики", subtitle: "Погрузка и выгрузка", icon: "dolly", accent: "#84763A", category: "specialists" },
  { key: "cleaning", title: "Уборка помещений", subtitle: "Клининг, генеральная", icon: "broom", accent: "#2E7D5B", category: "specialists" },
  { key: "lawyer", title: "Юристы", subtitle: "Консультации, документы", icon: "scale-balance", accent: "#4A5D6E", category: "intellectual" },
  { key: "finance", title: "Финансы и бухгалтерия", subtitle: "Учёт, отчётность", icon: "calculator", accent: "#2E7D5B", category: "intellectual" },
  { key: "webdev", title: "Создание сайтов и приложений", subtitle: "Веб, мобильные, боты", icon: "code-tags", accent: "#8A5CD1", category: "intellectual" }
];

const defaultCategories: Category[] = [
  { key: "tech", title: "Техника" },
  { key: "specialists", title: "Специалисты" },
  { key: "intellectual", title: "Интеллектуальные" }
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
    services: ["water", "septic", "dump", "excavator", "crane", "electrician", "plumber"]
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
