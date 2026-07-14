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
// Три мегакатегории: Техника (с ТТХ, в витрине), Специалисты (работа руками) и
// Интеллектуальные услуги. Ключи категорий совпадают с полем category у услуг ниже.
const categories = [
  { key: "tech", title: "Техника", sort: 1 },
  { key: "specialists", title: "Специалисты", sort: 2 },
  { key: "intellectual", title: "Интеллектуальные", sort: 3 }
];

const services = [
  // ── Техника (публикуется в витрине, с ТТХ) ───────────────────────────────
  { key: "crane", title: "Манипуляторы", subtitle: "Погрузка и доставка", icon: "crane", accent: "#7354A8", category: "tech", sort: 1 },
  { key: "autocrane", title: "Автокраны", subtitle: "Подъём грузов", icon: "crane", accent: "#8A5CD1", category: "tech", sort: 2 },
  { key: "septic", title: "Ассенизаторы", subtitle: "Откачка септиков и ям", icon: "truck-cargo-container", accent: "#6E7C45", category: "tech", sort: 3 },
  { key: "transport", title: "Грузовая техника", subtitle: "Бортовые, фургоны", icon: "truck", accent: "#556B8C", category: "tech", sort: 4 },
  { key: "dump", title: "Самосвалы", subtitle: "Песок, щебень, вывоз", icon: "dump-truck", accent: "#C1642E", category: "tech", sort: 5 },
  { key: "loader_front", title: "Погрузчики", subtitle: "Фронтальные, вилочные", icon: "forklift", accent: "#6E7C45", category: "tech", sort: 6 },
  { key: "excavator", title: "Экскаваторы", subtitle: "Копка, траншеи", icon: "excavator", accent: "#B8942E", category: "tech", sort: 7 },
  { key: "tractor", title: "Дорожная техника", subtitle: "Грейдер, каток, бульдозер", icon: "bulldozer", accent: "#A8862E", category: "tech", sort: 8 },
  { key: "water", title: "Водовозки", subtitle: "Питьевая и тех. вода", icon: "tanker-truck", accent: "#1683A7", category: "tech", sort: 9 },
  { key: "bus", title: "Автобусы, микроавтобусы", subtitle: "Пассажирские перевозки", icon: "bus", accent: "#3E7CB1", category: "tech", sort: 10 },
  { key: "auger", title: "Буровые установки, ямобуры", subtitle: "Столбы, сваи, скважины", icon: "screw-machine", accent: "#8C6D3A", category: "tech", sort: 11 },
  { key: "autotower", title: "Автоподъёмники", subtitle: "Работы на высоте", icon: "ladder", accent: "#C98A2E", category: "tech", sort: 12 },
  // ── Специалисты (работа руками) ──────────────────────────────────────────
  { key: "electrician", title: "Электрики", subtitle: "Монтаж и ремонт сети", icon: "flash", accent: "#D98A00", category: "specialists", sort: 20 },
  { key: "lowvoltage", title: "Слаботочники, КИПовцы", subtitle: "Сети, видеонаблюдение, КИПиА", icon: "ethernet-cable", accent: "#0E8A9C", category: "specialists", sort: 21 },
  { key: "welder", title: "Сварщики", subtitle: "Металлоконструкции, НАКС", icon: "fire", accent: "#C7503A", category: "specialists", sort: 22 },
  { key: "plumber", title: "Сантехники", subtitle: "Монтаж и ремонт", icon: "pipe-wrench", accent: "#2E7D5B", category: "specialists", sort: 23 },
  { key: "carpenter", title: "Плотники", subtitle: "Дерево, каркасы, отделка", icon: "hammer", accent: "#8C6D3A", category: "specialists", sort: 24 },
  { key: "loader", title: "Грузчики", subtitle: "Погрузка и выгрузка", icon: "dolly", accent: "#84763A", category: "specialists", sort: 25 },
  { key: "cleaning", title: "Уборка помещений", subtitle: "Клининг, генеральная", icon: "broom", accent: "#2E7D5B", category: "specialists", sort: 26 },
  { key: "operators", title: "Водители, операторы", subtitle: "Трактористы, машинисты", icon: "steering", accent: "#556B8C", category: "specialists", sort: 27 },
  { key: "autorepair", title: "Ремонт автотехники", subtitle: "Диагностика, ремонт", icon: "car-wrench", accent: "#B23B3B", category: "specialists", sort: 28 },
  { key: "tailor", title: "Пошив одежды и обуви", subtitle: "Ателье, ремонт", icon: "needle", accent: "#A85C8A", category: "specialists", sort: 29 },
  { key: "renovation", title: "Ремонт помещений", subtitle: "Жилые и нежилые", icon: "format-paint", accent: "#C98A2E", category: "specialists", sort: 30 },
  { key: "install", title: "Установка техники", subtitle: "Монтаж и подключение", icon: "tools", accent: "#556B8C", category: "specialists", sort: 31 },
  { key: "furniture", title: "Ремонт, сборка мебели", subtitle: "Сборка, реставрация", icon: "sofa", accent: "#8C6D3A", category: "specialists", sort: 32 },
  // ── Интеллектуальные услуги (по заявке) ──────────────────────────────────
  { key: "lawyer", title: "Юристы", subtitle: "Консультации, документы", icon: "scale-balance", accent: "#4A5D6E", category: "intellectual", sort: 40 },
  { key: "finance", title: "Финансы и бухгалтерия", subtitle: "Учёт, отчётность", icon: "calculator", accent: "#2E7D5B", category: "intellectual", sort: 41 },
  { key: "academic", title: "Рефераты, курсовые, дипломные", subtitle: "Учебные работы", icon: "school", accent: "#7354A8", category: "intellectual", sort: 42 },
  { key: "computer_repair", title: "Ремонт компьютерной техники", subtitle: "ПК, ноутбуки, ПО", icon: "laptop", accent: "#0E8A9C", category: "intellectual", sort: 43 },
  { key: "appliance_repair", title: "Ремонт бытовой техники", subtitle: "Стиральные, холодильники", icon: "washing-machine", accent: "#1683A7", category: "intellectual", sort: 44 },
  { key: "webdev", title: "Создание сайтов и приложений", subtitle: "Веб, мобильные, боты", icon: "code-tags", accent: "#8A5CD1", category: "intellectual", sort: 45 },
  { key: "photo", title: "Фото и видеосъёмка", subtitle: "Съёмка, монтаж", icon: "camera", accent: "#A85C8A", category: "intellectual", sort: 46 },
  { key: "print", title: "Распечатка и полиграфия", subtitle: "Печать, баннеры, визитки", icon: "printer", accent: "#C1642E", category: "intellectual", sort: 47 },
  { key: "docs_ppr", title: "Исполнительная документация, ППР", subtitle: "ИД, ППР, проекты", icon: "file-document-outline", accent: "#4A5D6E", category: "intellectual", sort: 48 },
  { key: "estimate", title: "Составление сметы, КС-2", subtitle: "Сметы, КС-2, КС-3", icon: "file-table", accent: "#556B8C", category: "intellectual", sort: 49 }
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
