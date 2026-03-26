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
 #define PING_INTERVAL   5000   // ms between heartbeat pings
 #define DEBOUNCE_DELAY  50     // ms debounce window
 
 // ── State ───────────────────────────────────────────────────────────────────
 int           msgCount        = 0;
 bool          lastButtonState = HIGH;
 bool          buttonArmed     = true;   // false while waiting out the debounce window
 unsigned long lastPingAt      = 0;
 unsigned long buttonPressedAt = 0;      // when the falling edge was first seen
 
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
 
   // ── SOS button (non-blocking debounce) ───────────────────────────────────
   bool currentButtonState = digitalRead(BUTTON_PIN);
 
   if (buttonArmed && lastButtonState == HIGH && currentButtonState == LOW) {
     // Falling edge detected — start the debounce timer, disarm until confirmed
     buttonPressedAt = now;
     buttonArmed     = false;
   }
 
   if (!buttonArmed && (now - buttonPressedAt >= DEBOUNCE_DELAY)) {
     // Debounce window has elapsed — check if pin is still LOW
     if (digitalRead(BUTTON_PIN) == LOW) {
       sendSOS();
     }
     buttonArmed = true;   // re-arm for the next press
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