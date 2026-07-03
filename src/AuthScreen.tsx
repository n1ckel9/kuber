import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ApiError, login, register, requestOtp, verifyOtp } from "./api";
import { LegalScreen } from "./LegalScreen";
import { colors, ui } from "./theme";
import { AuthResponse, Catalog, Role } from "./types";

type AuthScreenProps = {
  catalog: Catalog;
  onAuthenticated: (result: AuthResponse) => void;
};

type Mode = "login" | "register";
type Method = "phone" | "email";

// Телефон под стандарт +7 (XXX) XXX-XX-XX по мере ввода.
function formatPhone(input: string) {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("8")) {
    digits = "7" + digits.slice(1);
  }
  if (!digits.startsWith("7")) {
    digits = "7" + digits;
  }
  digits = digits.slice(0, 11);
  const d = digits.slice(1);
  let out = "+7";
  if (d.length > 0) out += " (" + d.slice(0, 3);
  if (d.length >= 3) out += ") " + d.slice(3, 6);
  if (d.length >= 6) out += "-" + d.slice(6, 8);
  if (d.length >= 8) out += "-" + d.slice(8, 10);
  return out;
}

export function AuthScreen({ catalog, onAuthenticated }: AuthScreenProps) {
  const [method, setMethod] = useState<Method>("phone");
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("client");
  const [cityId, setCityId] = useState(catalog.cities[0]?.id ?? "yakutsk");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Вход по телефону.
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState("");

  const [referralCode, setReferralCode] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [legalOpen, setLegalOpen] = useState<"privacy" | "terms" | null>(null);

  const isRegister = mode === "register";

  async function sendOtp() {
    setError("");
    if (phone.replace(/\D/g, "").length < 11) {
      setError("Введите номер полностью");
      return;
    }
    setBusy(true);
    try {
      const res = await requestOtp(phone);
      setOtpSent(true);
      setDevCode(res.devCode ?? "");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Сервер недоступен.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmOtp() {
    setError("");
    setBusy(true);
    try {
      onAuthenticated(await verifyOtp(phone, code.trim(), referralCode.trim() || undefined));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Сервер недоступен.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setError("");
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail.endsWith("@gmail.com")) {
      setError("Нужен адрес @gmail.com");
      return;
    }
    if (password.length < 6) {
      setError("Пароль от 6 символов");
      return;
    }
    if (isRegister && !name.trim()) {
      setError("Укажите имя");
      return;
    }

    if (isRegister && !agreed) {
      setError("Примите соглашение и политику конфиденциальности");
      return;
    }

    setBusy(true);
    try {
      const result = isRegister
        ? await register({
            name: name.trim(),
            email: cleanEmail,
            password,
            role,
            cityId,
            referralCode: referralCode.trim() || undefined
          })
        : await login({ email: cleanEmail, password });
      onAuthenticated(result);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : "Сервер недоступен. Проверьте, что API запущен (npm run server)."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={ui.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brand}>
            <View style={styles.logo}>
              <MaterialCommunityIcons name="tanker-truck" size={26} color={colors.accentText} />
            </View>
            <Text style={styles.title}>Кубер</Text>
            <Text style={styles.subtitle}>Спецтехника и вода по требованию</Text>
          </View>

          <View style={styles.tabs}>
            <Pressable
              onPress={() => setMethod("phone")}
              style={[styles.tab, method === "phone" && styles.tabActive]}
            >
              <Text style={[styles.tabText, method === "phone" && styles.tabTextActive]}>По телефону</Text>
            </Pressable>
            <Pressable
              onPress={() => setMethod("email")}
              style={[styles.tab, method === "email" && styles.tabActive]}
            >
              <Text style={[styles.tabText, method === "email" && styles.tabTextActive]}>Почта</Text>
            </Pressable>
          </View>

          {method === "phone" ? (
            <View style={ui.card}>
              <Text style={styles.cardTitle}>Вход по номеру</Text>
              <View style={ui.inputGroup}>
                <Text style={ui.label}>Телефон</Text>
                <TextInput
                  value={phone}
                  onChangeText={(v) => setPhone(formatPhone(v))}
                  placeholder="+7 (___) ___-__-__"
                  placeholderTextColor={colors.inkFaint}
                  keyboardType="phone-pad"
                  editable={!otpSent}
                  style={ui.input}
                />
              </View>

              {otpSent ? (
                <>
                  <View style={ui.inputGroup}>
                    <Text style={ui.label}>Код из SMS</Text>
                    <TextInput
                      value={code}
                      onChangeText={setCode}
                      placeholder="4 цифры"
                      placeholderTextColor={colors.inkFaint}
                      keyboardType="number-pad"
                      style={ui.input}
                    />
                  </View>
                  {devCode ? (
                    <Text style={styles.devHint}>Демо-режим: код {devCode} (в проде придёт по SMS)</Text>
                  ) : null}
                  {error ? <Text style={ui.errorText}>{error}</Text> : null}
                  <Pressable
                    style={[ui.primaryButton, busy && styles.disabled]}
                    onPress={confirmOtp}
                    disabled={busy}
                  >
                    <Text style={ui.primaryButtonText}>{busy ? "Подождите…" : "Войти"}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setOtpSent(false);
                      setCode("");
                      setDevCode("");
                    }}
                  >
                    <Text style={styles.switchText}>Изменить номер</Text>
                  </Pressable>
                </>
              ) : (
                <>
                  <View style={ui.inputGroup}>
                    <Text style={ui.label}>Код приглашения (необязательно)</Text>
                    <TextInput
                      value={referralCode}
                      onChangeText={setReferralCode}
                      placeholder="например, K1A2B3"
                      placeholderTextColor={colors.inkFaint}
                      autoCapitalize="characters"
                      style={ui.input}
                    />
                  </View>
                  {error ? <Text style={ui.errorText}>{error}</Text> : null}
                  <Pressable
                    style={[ui.primaryButton, busy && styles.disabled]}
                    onPress={sendOtp}
                    disabled={busy}
                  >
                    <Text style={ui.primaryButtonText}>{busy ? "Отправляем…" : "Получить код"}</Text>
                  </Pressable>
                  <Text style={styles.consent}>
                    Продолжая, вы принимаете{" "}
                    <Text style={styles.link} onPress={() => setLegalOpen("terms")}>
                      соглашение
                    </Text>{" "}
                    и{" "}
                    <Text style={styles.link} onPress={() => setLegalOpen("privacy")}>
                      политику
                    </Text>
                  </Text>
                </>
              )}
            </View>
          ) : (
          <>
          <View style={styles.tabs}>
            <Pressable
              onPress={() => setMode("login")}
              style={[styles.tab, !isRegister && styles.tabActive]}
            >
              <Text style={[styles.tabText, !isRegister && styles.tabTextActive]}>Вход</Text>
            </Pressable>
            <Pressable
              onPress={() => setMode("register")}
              style={[styles.tab, isRegister && styles.tabActive]}
            >
              <Text style={[styles.tabText, isRegister && styles.tabTextActive]}>Регистрация</Text>
            </Pressable>
          </View>

          <View style={ui.card}>
            {isRegister ? (
              <View style={ui.inputGroup}>
                <Text style={ui.label}>Имя</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Как к вам обращаться"
                  placeholderTextColor={colors.inkFaint}
                  style={ui.input}
                />
              </View>
            ) : null}

            <View style={ui.inputGroup}>
              <Text style={ui.label}>Gmail</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@gmail.com"
                placeholderTextColor={colors.inkFaint}
                autoCapitalize="none"
                keyboardType="email-address"
                style={ui.input}
              />
            </View>

            <View style={ui.inputGroup}>
              <Text style={ui.label}>Пароль</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="от 6 символов"
                placeholderTextColor={colors.inkFaint}
                secureTextEntry
                style={ui.input}
              />
            </View>

            {isRegister ? (
              <>
                <View style={ui.inputGroup}>
                  <Text style={ui.label}>Роль</Text>
                  <View style={styles.roleRow}>
                    {(["client", "driver"] as Role[]).map((value) => (
                      <Pressable
                        key={value}
                        onPress={() => setRole(value)}
                        style={[styles.roleCard, role === value && styles.roleCardActive]}
                      >
                        <MaterialCommunityIcons
                          name={value === "client" ? "account" : "steering"}
                          size={20}
                          color={role === value ? colors.accentText : colors.inkSoft}
                        />
                        <Text style={[styles.roleText, role === value && styles.roleTextActive]}>
                          {value === "client" ? "Заказчик" : "Исполнитель"}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={ui.inputGroup}>
                  <Text style={ui.label}>Город</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.cityRow}
                  >
                    {catalog.cities.map((city) => (
                      <Pressable
                        key={city.id}
                        onPress={() => setCityId(city.id)}
                        style={[ui.pill, city.id === cityId && ui.pillActive]}
                      >
                        <Text style={[ui.pillText, city.id === cityId && ui.pillTextActive]}>
                          {city.name}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </>
            ) : null}

            {isRegister ? (
              <>
                <View style={ui.inputGroup}>
                  <Text style={ui.label}>Код приглашения (необязательно)</Text>
                  <TextInput
                    value={referralCode}
                    onChangeText={setReferralCode}
                    placeholder="например, K1A2B3"
                    placeholderTextColor={colors.inkFaint}
                    autoCapitalize="characters"
                    style={ui.input}
                  />
                </View>
                <Pressable style={styles.checkboxRow} onPress={() => setAgreed(!agreed)}>
                  <MaterialCommunityIcons
                    name={agreed ? "checkbox-marked" : "checkbox-blank-outline"}
                    size={20}
                    color={colors.ink}
                  />
                  <Text style={styles.checkboxText}>
                    Принимаю{" "}
                    <Text style={styles.link} onPress={() => setLegalOpen("terms")}>
                      соглашение
                    </Text>{" "}
                    и{" "}
                    <Text style={styles.link} onPress={() => setLegalOpen("privacy")}>
                      политику
                    </Text>
                  </Text>
                </Pressable>
              </>
            ) : null}

            {error ? <Text style={ui.errorText}>{error}</Text> : null}

            <Pressable
              style={[ui.primaryButton, (busy || (isRegister && !agreed)) && styles.disabled]}
              onPress={submit}
              disabled={busy || (isRegister && !agreed)}
            >
              <Text style={ui.primaryButtonText}>
                {busy ? "Подождите…" : isRegister ? "Создать аккаунт" : "Войти"}
              </Text>
            </Pressable>
          </View>

          <Pressable onPress={() => setMode(isRegister ? "login" : "register")}>
            <Text style={styles.switchText}>
              {isRegister ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
            </Text>
          </Pressable>
          </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {legalOpen ? <LegalScreen type={legalOpen} onClose={() => setLegalOpen(null)} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1
  },
  content: {
    padding: 22,
    gap: 18,
    justifyContent: "center",
    flexGrow: 1
  },
  brand: {
    alignItems: "center",
    gap: 8,
    marginBottom: 4
  },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6
  },
  title: {
    color: colors.ink,
    fontSize: 28,
    fontWeight: "800"
  },
  subtitle: {
    color: colors.inkSoft,
    fontSize: 14
  },
  cardTitle: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  devHint: { color: colors.inkFaint, fontSize: 12 },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    padding: 4,
    gap: 4
  },
  tab: {
    flex: 1,
    minHeight: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center"
  },
  tabActive: {
    backgroundColor: colors.surface
  },
  tabText: {
    color: colors.inkSoft,
    fontSize: 14,
    fontWeight: "700"
  },
  tabTextActive: {
    color: colors.ink
  },
  roleRow: {
    flexDirection: "row",
    gap: 10
  },
  roleCard: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8
  },
  roleCardActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink
  },
  roleText: {
    color: colors.inkSoft,
    fontSize: 14,
    fontWeight: "700"
  },
  roleTextActive: {
    color: colors.accentText
  },
  cityRow: {
    gap: 8,
    paddingVertical: 2
  },
  switchText: {
    color: colors.inkSoft,
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center"
  },
  disabled: {
    opacity: 0.6
  },
  checkboxRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkboxText: { flex: 1, color: colors.inkSoft, fontSize: 13 },
  consent: { color: colors.inkFaint, fontSize: 12, textAlign: "center" },
  link: { color: colors.ink, fontWeight: "700", textDecorationLine: "underline" }
});
