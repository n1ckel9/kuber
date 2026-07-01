// Стартовые данные. Иерархия: регион -> города -> услуги (доступность задаётся
// на уровне города). Добавление нового региона/города/услуги делается здесь
// (или позже через админ-эндпоинты) и не требует пересборки приложения.

const regions = [
  { id: "sakha", name: "Республика Саха (Якутия)", sort: 1 },
  { id: "tatarstan", name: "Татарстан", sort: 2 },
  { id: "novosibirsk_obl", name: "Новосибирская область", sort: 3 }
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
    id: "mirny",
    regionId: "sakha",
    name: "Мирный",
    center: [113.964, 62.535],
    zoom: 12,
    sort: 2
  },
  {
    id: "kazan",
    regionId: "tatarstan",
    name: "Казань",
    center: [49.106414, 55.796127],
    zoom: 11,
    sort: 1
  },
  {
    id: "chelny",
    regionId: "tatarstan",
    name: "Набережные Челны",
    center: [52.39577, 55.743553],
    zoom: 11,
    sort: 2
  },
  {
    id: "novosibirsk",
    regionId: "novosibirsk_obl",
    name: "Новосибирск",
    center: [82.92043, 55.030204],
    zoom: 11,
    sort: 1
  }
];

const services = [
  {
    key: "water",
    title: "Водовоз",
    subtitle: "Питьевая и тех. вода",
    icon: "tanker-truck",
    accent: "#1683A7",
    sort: 1
  },
  {
    key: "septic",
    title: "Ассенизатор",
    subtitle: "Септик, выгребная яма",
    icon: "truck-cargo-container",
    accent: "#6E7C45",
    sort: 2
  },
  {
    key: "dump",
    title: "КамАЗ",
    subtitle: "Песок, щебень, вывоз",
    icon: "dump-truck",
    accent: "#C1642E",
    sort: 3
  },
  {
    key: "crane",
    title: "Манипулятор",
    subtitle: "Погрузка и доставка",
    icon: "crane",
    accent: "#7354A8",
    sort: 4
  },
  {
    key: "tractor",
    title: "Спецтехника",
    subtitle: "Трактор, экскаватор",
    icon: "excavator",
    accent: "#B8942E",
    sort: 5
  }
];

// Какие услуги доступны в каждом городе. Якутск — полный набор,
// остальные показывают, что список услуг гибко настраивается по городам.
const cityServices = {
  yakutsk: ["water", "septic", "dump", "crane", "tractor"],
  mirny: ["water", "dump", "crane"],
  kazan: ["water", "septic", "dump", "crane", "tractor"],
  chelny: ["water", "dump", "crane"],
  novosibirsk: ["water", "septic", "dump", "tractor"]
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

module.exports = { regions, cities, services, cityServices, orders };
