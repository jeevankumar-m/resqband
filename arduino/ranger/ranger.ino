```cpp
/*
 * ResqBand — Ranger Node
 *
 * Behaviour:
 *   • Sends a PING heartbeat every PING_INTERVAL ms.
 *   • SOS button     → sends SOS packet + blinks red LED 3 times then stops.
 *   • Tracker button → toggles buzzer navigation mode + green LED.
 *   • Buzzer beep pattern tracks RSSI when tracker mode is ON.
 *     Close  → fast clean beeps
 *     Mid    → medium pace beeps
 *     Far    → slow crackly beeps
 *     No sig → silent
 */

#include <SPI.h>
#include <LoRa.h>

// ── Pin config ──────────────────────────────────────────────────────────────
#define LORA_SS       5
#define LORA_RST      14
#define LORA_DIO0     2
#define BTN_SOS       4
#define BTN_TRACKER   22
#define BUZZER_PIN    33
#define LED_GREEN     32
#define LED_RED       27

// ── PWM config ──────────────────────────────────────────────────────────────
#define BUZZER_FREQ       2000
#define BUZZER_RESOLUTION 8

// ── RSSI thresholds (dBm) ───────────────────────────────────────────────────
#define RSSI_CLOSE  -50
#define RSSI_MID    -80
#define RSSI_FAR    -110

// ── Signal timeout ──────────────────────────────────────────────────────────
#define SIGNAL_TIMEOUT 15000

// ── Timing ──────────────────────────────────────────────────────────────────
#define PING_INTERVAL  5000
#define DEBOUNCE_DELAY 50

// ── Red LED blink config ─────────────────────────────────────────────────────
#define LED_BLINK_ON    150
#define LED_BLINK_OFF   150
#define LED_BLINK_COUNT 3

// ── Beep profiles ────────────────────────────────────────────────────────────
struct BeepProfile {
  unsigned long onMs;
  unsigned long offMs;
  int           duty;
  bool          crackle;
};

BeepProfile ZONE_CLOSE  = { 80,   120,  220, false };
BeepProfile ZONE_MID    = { 120,  380,  140, false };
BeepProfile ZONE_FAR    = { 180,  900,  60,  true  };
BeepProfile ZONE_SILENT = { 0,    1000, 0,   false };

// ── State ───────────────────────────────────────────────────────────────────
int           msgCount     = 0;
unsigned long lastPingAt   = 0;
unsigned long lastPacketAt = 0;
int           lastRssi     = -999;
bool          trackerOn    = false;

// SOS button
bool          sosBtnArmed  = true;
bool          sosLastState = HIGH;
unsigned long sosPressedAt = 0;

// Tracker button
bool          trkBtnArmed  = true;
bool          trkLastState = HIGH;
unsigned long trkPressedAt = 0;

// Buzzer FSM
enum BuzzerState { BUZ_ON, BUZ_OFF };
BuzzerState   buzState   = BUZ_OFF;
unsigned long buzStateAt = 0;
BeepProfile*  currentZone = &ZONE_SILENT;

// Red LED blink FSM
int           redBlinkCount = 0;
bool          redLedOn      = false;
unsigned long redLedStateAt = 0;

// ── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  pinMode(BTN_SOS,     INPUT_PULLUP);
  pinMode(BTN_TRACKER, INPUT_PULLUP);
  pinMode(LED_GREEN,   OUTPUT);
  pinMode(LED_RED,     OUTPUT);

  digitalWrite(LED_GREEN, LOW);
  digitalWrite(LED_RED,   LOW);

  ledcAttach(BUZZER_PIN, BUZZER_FREQ, BUZZER_RESOLUTION);
  ledcWrite(BUZZER_PIN, 0);

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println("LoRa init FAILED. Check wiring.");
    while (1);
  }

  LoRa.receive();
  Serial.println("Ranger ready.");
}

// ── Loop ────────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  // ── Periodic ping ────────────────────────────────────────────────────────
  if (now - lastPingAt >= PING_INTERVAL) {
    lastPingAt = now;
    sendPing();
  }

  // ── SOS button ───────────────────────────────────────────────────────────
  bool sosNow = digitalRead(BTN_SOS);
  if (sosBtnArmed && sosLastState == HIGH && sosNow == LOW) {
    sosPressedAt = now;
    sosBtnArmed  = false;
  }
  if (!sosBtnArmed && (now - sosPressedAt >= DEBOUNCE_DELAY)) {
    if (digitalRead(BTN_SOS) == LOW) sendSOS();
    sosBtnArmed = true;
  }
  sosLastState = sosNow;

  // ── Tracker toggle button ─────────────────────────────────────────────────
    bool trkNow = digitalRead(BTN_TRACKER);
  Serial.print("TRK PIN: "); Serial.println(trkNow);   // add this line temporarily

  if (trkBtnArmed && trkLastState == HIGH && trkNow == LOW) {
    trkPressedAt = now;
    trkBtnArmed  = false;
  }
  if (!trkBtnArmed && (now - trkPressedAt >= DEBOUNCE_DELAY)) {
    if (digitalRead(BTN_TRACKER) == LOW) {
      trackerOn = !trackerOn;
      Serial.print("Tracker toggled → "); Serial.println(trackerOn ? "ON" : "OFF");
      digitalWrite(LED_GREEN, trackerOn ? HIGH : LOW);
      // ... rest unchanged
    }
    trkBtnArmed = true;
  }
  trkLastState = trkNow;

  // ── Incoming packet handler ───────────────────────────────────────────────
  int packetSize = LoRa.parsePacket();
  if (packetSize) {
    String incoming = "";
    while (LoRa.available()) incoming += (char)LoRa.read();

    int rssi = LoRa.packetRssi();
    Serial.print("Received: ["); Serial.print(incoming);
    Serial.print("] RSSI: "); Serial.print(rssi); Serial.println(" dBm");

    if (incoming.startsWith("PONG:") || incoming.startsWith("PING:")) {
      lastRssi     = rssi;
      lastPacketAt = now;
      if (trackerOn) updateZone(rssi);
    }
  }

  // ── Signal timeout ────────────────────────────────────────────────────────
  if (trackerOn && lastPacketAt > 0 && (now - lastPacketAt >= SIGNAL_TIMEOUT)) {
    if (currentZone != &ZONE_SILENT) {
      Serial.println("Signal lost → silent");
      currentZone = &ZONE_SILENT;
      ledcWrite(BUZZER_PIN, 0);
      buzState = BUZ_OFF;
    }
  }

  // ── Buzzer FSM ────────────────────────────────────────────────────────────
  if (trackerOn) tickBuzzer(now);

  // ── Red LED blink FSM ─────────────────────────────────────────────────────
  tickRedLed(now);
}

// ── Zone selector ────────────────────────────────────────────────────────────
void updateZone(int rssi) {
  BeepProfile* newZone;

  if      (rssi >= RSSI_CLOSE) newZone = &ZONE_CLOSE;
  else if (rssi >= RSSI_MID)   newZone = &ZONE_MID;
  else if (rssi >= RSSI_FAR)   newZone = &ZONE_FAR;
  else                          newZone = &ZONE_SILENT;

  if (newZone != currentZone) {
    currentZone = newZone;
    buzState    = BUZ_OFF;
    buzStateAt  = millis();
    ledcWrite(BUZZER_PIN, 0);
    Serial.print("Zone → ");
    Serial.println(newZone == &ZONE_CLOSE ? "CLOSE"
                 : newZone == &ZONE_MID   ? "MID"
                 : newZone == &ZONE_FAR   ? "FAR"
                                          : "SILENT");
  }
}

// ── Buzzer FSM tick ──────────────────────────────────────────────────────────
void tickBuzzer(unsigned long now) {
  if (currentZone == &ZONE_SILENT) {
    ledcWrite(BUZZER_PIN, 0);
    return;
  }

  unsigned long elapsed = now - buzStateAt;

  if (buzState == BUZ_OFF && elapsed >= currentZone->offMs) {
    buzState   = BUZ_ON;
    buzStateAt = now;
    ledcWrite(BUZZER_PIN, currentZone->duty);

  } else if (buzState == BUZ_ON && elapsed >= currentZone->onMs) {
    buzState   = BUZ_OFF;
    buzStateAt = now;
    ledcWrite(BUZZER_PIN, 0);

  } else if (buzState == BUZ_ON && currentZone->crackle) {
    int jitter = random(-30, 30);
    int duty   = constrain(currentZone->duty + jitter, 10, 255);
    ledcWrite(BUZZER_PIN, duty);
  }
}

// ── Red LED blink FSM ────────────────────────────────────────────────────────
void tickRedLed(unsigned long now) {
  if (redBlinkCount == 0) return;

  unsigned long elapsed = now - redLedStateAt;

  if (redLedOn && elapsed >= LED_BLINK_ON) {
    digitalWrite(LED_RED, LOW);
    redLedOn      = false;
    redLedStateAt = now;

  } else if (!redLedOn && elapsed >= LED_BLINK_OFF) {
    redBlinkCount--;
    if (redBlinkCount == 0) {
      digitalWrite(LED_RED, LOW);
      Serial.println("Red LED blink done");
      return;
    }
    digitalWrite(LED_RED, HIGH);
    redLedOn      = true;
    redLedStateAt = now;
  }
}

// ── Transmit helpers ────────────────────────────────────────────────────────
void sendPing() {
  msgCount++;
  String packet = "PING:RANGER-01:MSG#" + String(msgCount);
  LoRa.beginPacket();
  LoRa.print(packet);
  int result = LoRa.endPacket();
  LoRa.receive();
  Serial.print("Ping sent → "); Serial.print(packet);
  Serial.print(" | TX: "); Serial.println(result == 1 ? "OK" : "FAILED");
}

void sendSOS() {
  msgCount++;
  String packet = "SOS:RANGER-01:MSG#" + String(msgCount);
  LoRa.beginPacket();
  LoRa.print(packet);
  int result = LoRa.endPacket();
  LoRa.receive();

  // Kick off red LED blink sequence
  redBlinkCount = LED_BLINK_COUNT;
  redLedOn      = true;
  redLedStateAt = millis();
  digitalWrite(LED_RED, HIGH);

  Serial.print("SOS sent → "); Serial.print(packet);
  Serial.print(" | TX: "); Serial.println(result == 1 ? "OK" : "FAILED");
}