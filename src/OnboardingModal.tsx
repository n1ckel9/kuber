import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { createPlace, reverseGeocode, updateProfile } from "./api";
import { getCurrentPosition } from "./geo";
import { colors, ui } from "./theme";
import { Account } from "./types";

// Быстрый онбординг заказчика: имя → адрес «Дом» по геолокации → к первому заказу.
export function OnboardingModal({
  visible,
  account,
  onComplete
}: {
  visible: boolean;
  account: Account;
  onComplete: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(account.name && !account.name.startsWith("+") ? account.name : "");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function saveName() {
    if (!name.trim()) {
      setNote("Введите имя");
      return;
    }
    setBusy(true);
    setNote("");
    try {
      await updateProfile({ name: name.trim(), role: account.role, cityId: account.cityId });
      setStep(1);
    } catch {
      setNote("Не удалось сохранить. Проверьте связь.");
    } finally {
      setBusy(false);
    }
  }

  async function saveHome() {
    setBusy(true);
    setNote("");
    try {
      const pos = await getCurrentPosition();
      if (!pos) {
        setNote("Не удалось получить геопозицию. Можно пропустить и указать адрес позже.");
        return;
      }
      const rev = await reverseGeocode(pos[1], pos[0]);
      const label = "Дом";
      const fromText = rev?.displayName || `Точка ${pos[1].toFixed(5)}, ${pos[0].toFixed(5)}`;
      await createPlace({ label, fromText, lng: pos[0], lat: pos[1] });
      onComplete();
    } catch {
      setNote("Не удалось сохранить адрес. Можно пропустить.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onComplete}>
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: 24, gap: 16 }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <MaterialCommunityIcons name="hand-wave-outline" size={40} color={colors.ink} />
          <Text style={{ fontSize: 22, fontWeight: "800", color: colors.ink }}>Добро пожаловать в Кубер</Text>
          <Text style={{ color: colors.inkSoft, textAlign: "center" }}>
            {step === 0 ? "Как к вам обращаться?" : "Сохраните адрес — и заказ займёт пару секунд"}
          </Text>
        </View>

        {step === 0 ? (
          <>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Ваше имя"
              placeholderTextColor={colors.inkFaint}
              autoFocus
              style={ui.input}
            />
            {note ? <Text style={ui.errorText}>{note}</Text> : null}
            <Pressable style={ui.primaryButton} onPress={saveName} disabled={busy}>
              <Text style={ui.primaryButtonText}>{busy ? "…" : "Далее"}</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable style={ui.primaryButton} onPress={saveHome} disabled={busy}>
              <MaterialCommunityIcons name="map-marker-check" size={18} color={colors.accentText} />
              <Text style={ui.primaryButtonText}>{busy ? "…" : "Сохранить адрес «Дом»"}</Text>
            </Pressable>
            {note ? <Text style={ui.errorText}>{note}</Text> : null}
            <Pressable onPress={onComplete}>
              <Text style={{ color: colors.inkSoft, textAlign: "center", fontWeight: "700" }}>Пропустить</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}
