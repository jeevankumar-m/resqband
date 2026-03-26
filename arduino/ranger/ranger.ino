/*
 * ResqBand — Ranger Node
 *
 * Behaviour:
 *   • Sends a PING heartbeat every PING_INTERVAL ms so the hub always has
 *     a fresh RSSI reading and the radar stays updated.
 *   • Pressing the button sends an SOS packet immediately.
 *
 * Packet format  →  TYPE:SENDER-ID:MSG#N
 *   Heartbeat    →  PING:RANGER-01:MSG#5
 *   Emergency    →  SOS:RANGER-01:MSG#6
 */

#include <SPI.h>
#include <LoRa.h>

// ── Pin config ──────────────────────────────────────────────────────────────
#define LORA_SS    5
#define LORA_RST   14
#define LORA_DIO0  2
#define BUTTON_PIN 4

// ── Timing ──────────────────────────────────────────────────────────────────
#define PING_INTERVAL 5000    // ms between heartbeat pings

// ── State ───────────────────────────────────────────────────────────────────
int           msgCount       = 0;
bool          lastButtonState = HIGH;
unsigned long lastPingAt     = 0;

// ── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println("LoRa init failed!");
    while (1);
  }

  Serial.println("Ranger ready. Heartbeat every 5 s. Press button for SOS.");
}

// ── Loop ────────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // ── Periodic ping ────────────────────────────────────────────────────────
  if (now - lastPingAt >= PING_INTERVAL) {
    lastPingAt = now;
    sendPing();
  }

  // ── SOS button (debounced falling edge) ──────────────────────────────────
  bool currentButtonState = digitalRead(BUTTON_PIN);
  if (lastButtonState == HIGH && currentButtonState == LOW) {
    delay(50);
    if (digitalRead(BUTTON_PIN) == LOW) {
      sendSOS();
    }
  }
  lastButtonState = currentButtonState;
}

// ── Transmit helpers ────────────────────────────────────────────────────────
void sendPing() {
  msgCount++;
  String packet = "PING:RANGER-01:MSG#" + String(msgCount);

  LoRa.beginPacket();
  LoRa.print(packet);
  LoRa.endPacket();

  Serial.println("Ping sent → " + packet);
}

void sendSOS() {
  msgCount++;
  String packet = "SOS:RANGER-01:MSG#" + String(msgCount);

  LoRa.beginPacket();
  LoRa.print(packet);
  LoRa.endPacket();

  Serial.println("SOS sent → " + packet);
}
