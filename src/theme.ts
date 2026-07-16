import { StyleSheet } from "react-native";

// Чистая светлая палитра с фирменным индиго-акцентом. Текст — сине-чёрный,
// бренд — индиго (кнопки, активные состояния, акценты). Цвета услуг — точечно.
export const colors = {
  bg: "#F4F6FB",
  surface: "#FFFFFF",
  surfaceMuted: "#EDF0F7",
  line: "#E3E8F2",
  ink: "#151A24",
  inkSoft: "#5B6474",
  inkFaint: "#98A1B3",
  accent: "#4F46E5",
  accentSoft: "#EEF0FE",
  accentText: "#FFFFFF",
  positive: "#15A05A",
  positiveBg: "#E4F5EA",
  warning: "#C05621",
  warningBg: "#F7EADF",
  // Акценты для повторяющихся значков (вынесены из разбросанного хардкода).
  verified: "#0E9F8E",
  star: "#F59E0B",
  favorite: "#EF4444",
  coinBg: "#F0B84A",
  coinText: "#5C3D0E"
};

export const radius = 16;

// Мягкая тень карточек (кроссплатформенно: iOS shadow* / Android elevation / web boxShadow).
export const cardShadow = {
  shadowColor: "#151A24",
  shadowOpacity: 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2
};

// Переиспользуемые «атомы» интерфейса — общие для экрана входа и приложения.
export const ui = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 14,
    ...cardShadow
  },
  label: {
    color: colors.inkFaint,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4
  },
  inputGroup: {
    gap: 6
  },
  input: {
    minHeight: 48,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius - 4,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 15,
    fontWeight: "500"
  },
  textArea: {
    minHeight: 84,
    paddingTop: 12,
    textAlignVertical: "top"
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: radius - 2,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8
  },
  primaryButtonText: {
    color: colors.accentText,
    fontSize: 16,
    fontWeight: "700"
  },
  ghostButton: {
    minHeight: 48,
    borderRadius: radius - 2,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8
  },
  ghostButtonText: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700"
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  pillActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent
  },
  pillText: {
    color: colors.inkSoft,
    fontSize: 13,
    fontWeight: "700"
  },
  pillTextActive: {
    color: colors.accentText
  },
  errorText: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: "600"
  }
});
