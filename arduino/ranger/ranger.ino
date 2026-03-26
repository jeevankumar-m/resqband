/*
 * ResqBand — Ranger Node
 *
 * Behaviour:
 *   • Sends a PING heartbeat every PING_INTERVAL ms.
 *   • Pressing the button sends an SOS packet immediately.
 *   • Buzzer volume tracks RSSI of the last received PONG from hub.
 *     Louder = stronger signal = closer to hub.
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
 #define BUZZER_PIN 33
 
 // ── PWM config ──────────────────────────────────────────────────────────────
 #define BUZZER_CHANNEL   0
 #define BUZZER_FREQ      2000    // Hz — 2kHz is a clear audible tone
 #define BUZZER_RESOLUTION 8      // 8-bit → duty range 0–255
 
 // ── RSSI range (dBm) — tune these to your environment ──────────────────────
 #define RSSI_MIN  -120   // weakest signal → buzzer silent
 #define RSSI_MAX  -20    // strongest signal → buzzer loudest
 
 // ── Timing ──────────────────────────────────────────────────────────────────
 #define PING_INTERVAL  5000   // ms between heartbeat pings
 #define DEBOUNCE_DELAY 50     // ms debounce window
 
 // ── State ───────────────────────────────────────────────────────────────────
 int           msgCount        = 0;
 bool          lastButtonState = HIGH;
 bool          buttonArmed     = true;
 unsigned long lastPingAt      = 0;
 unsigned long buttonPressedAt = 0;
 int           lastRssi        = RSSI_MIN;   // start silent until first PONG
 
 // ── Setup ───────────────────────────────────────────────────────────────────
 void setup() {
   Serial.begin(115200);
   pinMode(BUTTON_PIN, INPUT_PULLUP);
 
   // Buzzer PWM setup
   ledcSetup(BUZZER_CHANNEL, BUZZER_FREQ, BUZZER_RESOLUTION);
   ledcAttachPin(BUZZER_PIN, BUZZER_CHANNEL);
   ledcWrite(BUZZER_CHANNEL, 0);   // silent on boot
 
   LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
   if (!LoRa.begin(433E6)) {
     Serial.println("LoRa init FAILED. Check wiring.");
     while (1);
   }
 
   LoRa.receive();
   Serial.println("Ranger ready. Heartbeat every 5s. Press button for SOS.");
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
     buttonPressedAt = now;
     buttonArmed     = false;
   }
 
   if (!buttonArmed && (now - buttonPressedAt >= DEBOUNCE_DELAY)) {
     if (digitalRead(BUTTON_PIN) == LOW) {
       sendSOS();
     }
     buttonArmed = true;
   }
 
   lastButtonState = currentButtonState;
 
   // ── Incoming packet handler ───────────────────────────────────────────────
   int packetSize = LoRa.parsePacket();
   if (packetSize) {
     String incoming = "";
     while (LoRa.available()) {
       incoming += (char)LoRa.read();
     }
 
     int rssi = LoRa.packetRssi();
 
     Serial.print("Received: [");
     Serial.print(incoming);
     Serial.print("] RSSI: ");
     Serial.print(rssi);
     Serial.println(" dBm");
 
     // Update buzzer volume on any packet from hub (PONG or PING)
     if (incoming.startsWith("PONG:") || incoming.startsWith("PING:")) {
       lastRssi = rssi;
       updateBuzzer(rssi);
     }
   }
 }
 
 // ── Buzzer ───────────────────────────────────────────────────────────────────
 void updateBuzzer(int rssi) {
   // Clamp RSSI to expected range
   int clamped = constrain(rssi, RSSI_MIN, RSSI_MAX);
 
   // Map RSSI → PWM duty (0 = silent, 255 = loudest)
   int duty = map(clamped, RSSI_MIN, RSSI_MAX, 0, 255);
 
   ledcWrite(BUZZER_CHANNEL, duty);
 
   Serial.print("Buzzer duty → ");
   Serial.print(duty);
   Serial.print(" / 255  (RSSI: ");
   Serial.print(rssi);
   Serial.println(" dBm)");
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
 
   Serial.print("SOS sent → "); Serial.print(packet);
   Serial.print(" | TX: "); Serial.println(result == 1 ? "OK" : "FAILED");
 }