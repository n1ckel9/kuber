// Стартовые данные. Иерархия: регион -> города -> услуги (доступность задаётся
// на уровне города). Добавление нового региона/города/услуги делается здесь
// (или позже через админ-эндпоинты) и не требует пересборки приложения.

const regions = [
  { id: "sakha", name: "Республика Саха (Якутия)", sort: 1 },
  { id: "sverdlovsk_obl", name: "Свердловская область", sort: 2 },
  { id: "tyumen_obl", name: "Тюменская область", sort: 3 }
];

const cities = [
  {
    id: "yakutsk",
    regionId: "sakha",
    name: "Якутск",
    center: [129.732178, 62.027833],
    zoom: 12,
    sort: 1
  },
  {
    id: "ekaterinburg",
    regionId: "sverdlovsk_obl",
    name: "Екатеринбург",
    center: [60.597474, 56.838011],
    zoom: 11,
    sort: 2
  },
  {
    id: "tyumen",
    regionId: "tyumen_obl",
    name: "Тюмень",
    center: [65.534328, 57.153033],
    zoom: 11,
    sort: 3
  }
];

// Категории группируют услуги в интерфейсе (вкладки при выборе, разделы в профиле).
// Ключи категорий должны совпадать с полем category у услуг ниже.
const categories = [
  { key: "equipment", title: "Спецтехника", sort: 1 },
  { key: "transport", title: "Перевозки и вывоз", sort: 2 },
  { key: "utilities", title: "Вода и коммунальные", sort: 3 },
  { key: "electric", title: "Мастера", sort: 4 }
];

const services = [
  // Доставка и вывоз
  { key: "dump", title: "Самосвал", subtitle: "Песок, щебень, вывоз", icon: "dump-truck", accent: "#C1642E", category: "transport", sort: 2 },
  { key: "transport", title: "Перевозки", subtitle: "Грузовики, фургоны", icon: "truck", accent: "#556B8C", category: "transport", sort: 3 },
  { key: "evac", title: "Эвакуатор", subtitle: "Эвакуация авто", icon: "tow-truck", accent: "#B23B3B", category: "transport", sort: 5 },
  { key: "snow", title: "Снегоуборка", subtitle: "Уборка и вывоз снега", icon: "snowflake", accent: "#3E7CB1", category: "transport", sort: 6 },
  { key: "trailer", title: "Трал / негабарит", subtitle: "Перевозка техники", icon: "truck-trailer", accent: "#4A5D6E", category: "transport", sort: 7 },
  // Спецтехника
  { key: "crane", title: "Манипулятор", subtitle: "Погрузка и доставка", icon: "crane", accent: "#7354A8", category: "equipment", sort: 10 },
  { key: "autocrane", title: "Автокран", subtitle: "Подъём грузов", icon: "crane", accent: "#8A5CD1", category: "equipment", sort: 11 },
  { key: "autotower", title: "Автовышка", subtitle: "Работы на высоте", icon: "ladder", accent: "#C98A2E", category: "equipment", sort: 12 },
  { key: "excavator", title: "Экскаватор", subtitle: "Копка, траншеи", icon: "excavator", accent: "#B8942E", category: "equipment", sort: 13 },
  { key: "loader_front", title: "Погрузчик", subtitle: "Фронтальный, вилочный", icon: "forklift", accent: "#6E7C45", category: "equipment", sort: 14 },
  { key: "tractor", title: "Трактор / бульдозер", subtitle: "Трактор, бульдозер, грейдер", icon: "tractor", accent: "#A8862E", category: "equipment", sort: 15 },
  { key: "concrete", title: "Бетон", subtitle: "Насос, миксер", icon: "cube-outline", accent: "#7A7A7A", category: "equipment", sort: 16 },
  { key: "auger", title: "Ямобур", subtitle: "Столбы, сваи", icon: "screw-machine", accent: "#8C6D3A", category: "equipment", sort: 17 },
  // Вода и коммунальные
  { key: "water", title: "Водовоз", subtitle: "Питьевая и тех. вода", icon: "tanker-truck", accent: "#1683A7", category: "utilities", sort: 19 },
  { key: "septic", title: "Ассенизатор", subtitle: "Септик, выгребная яма", icon: "truck-cargo-container", accent: "#6E7C45", category: "utilities", sort: 20 },
  { key: "drilling", title: "Бурение скважин", subtitle: "Скважины на воду", icon: "water-pump", accent: "#1B6E8C", category: "utilities", sort: 22 },
  // Мастера (работа руками)
  { key: "loader", title: "Грузчики", subtitle: "Погрузка и выгрузка", icon: "dolly", accent: "#84763A", category: "electric", sort: 28 },
  { key: "plumber", title: "Сантехник", subtitle: "Монтаж и ремонт", icon: "pipe-wrench", accent: "#2E7D5B", category: "electric", sort: 29 },
  { key: "electrician", title: "Электрик", subtitle: "Монтаж и ремонт сети", icon: "flash", accent: "#D98A00", category: "electric", sort: 30 },
  { key: "welder", title: "Сварщик", subtitle: "Металлоконструкции", icon: "fire", accent: "#C7503A", category: "electric", sort: 31 },
  { key: "lowvoltage", title: "Слаботочник", subtitle: "Сети, видеонаблюдение", icon: "ethernet-cable", accent: "#0E8A9C", category: "electric", sort: 32 }
];

// Какие услуги доступны в каждом городе. Якутск — полный набор,
// остальные показывают, что список услуг гибко настраивается по городам.
const allKeys = services.map((s) => s.key);
const cityServices = {
  yakutsk: allKeys,
  ekaterinburg: allKeys,
  tyumen: allKeys
};

const orders = [
  {
    id: "1428",
    cityId: "yakutsk",
    service: "water",
    from: "Якутск, район Сайсары",
    details: "Нужно 5 кубов технической воды сегодня до 18:00",
    price: 4200,
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
    status: "matched",
    coordinates: [129.6534, 62.0814],
    customerName: "Семен",
    bids: [{ id: "b4", driver: "Манипулятор Якутск", price: 12500, eta: "завтра 9:00", rating: 5 }]
  }
];

module.exports = { regions, cities, services, categories, cityServices, orders };
