import { StyleSheet } from "react-native";

// Минималистичная палитра: тёплый фон, белые карточки, тонкие линии,
// чёрная основная кнопка. Цветные акценты услуг используются точечно.
export const colors = {
  bg: "#F7F4EE",
  surface: "#FFFFFF",
  surfaceMuted: "#F3F0E9",
  line: "#E9E3D8",
  ink: "#1A1A1A",
  inkSoft: "#6B6B6B",
  inkFaint: "#9A958C",
  accent: "#1A1A1A",
  accentText: "#FFFFFF",
  positive: "#3F6B3A",
  positiveBg: "#EAF0E6",
  warning: "#9A5A2B",
  warningBg: "#F4EAE0"
};

export const radius = 14;

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
    gap: 14
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
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 9
  },
  pillActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink
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
