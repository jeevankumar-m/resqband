/*
 * ResqBand — Hub Node
 *
 * Behaviour:
 *   • Listens for incoming LoRa packets continuously.
 *   • Responds to PING heartbeats from rangers with a PONG.
 *   • Pressing the button sends an SOS packet immediately.
 *   • Sends its own PING heartbeat every PING_INTERVAL ms.
 *
 * Packet format  →  TYPE:SENDER-ID:MSG#N
 *   Heartbeat    →  PING:HUB-01:MSG#5
 *   Emergency    →  SOS:HUB-01:MSG#6
 *   Pong reply   →  PONG:HUB-01
 */

 #include <SPI.h>
 #include <LoRa.h>
 
 // ── Pin config ──────────────────────────────────────────────────────────────
 #define LORA_SS    5
 #define LORA_RST   14
 #define LORA_DIO0  26
 #define BUTTON_PIN 25
 
 // ── Timing ──────────────────────────────────────────────────────────────────
 #define PING_INTERVAL  5000   // ms between heartbeat pings
 #define DEBOUNCE_DELAY 50     // ms debounce window
 
 // ── State ───────────────────────────────────────────────────────────────────
 int           msgCount        = 0;
 bool          lastButtonState = HIGH;
 bool          buttonArmed     = true;
 unsigned long lastPingAt      = 0;
 unsigned long buttonPressedAt = 0;
 
 // ── Setup ───────────────────────────────────────────────────────────────────
 void setup() {
   Serial.begin(115200);
   while (!Serial);
 
   Serial.println("=== HUB BOOT ===");
   pinMode(BUTTON_PIN, INPUT_PULLUP);
 
   LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
   if (!LoRa.begin(433E6)) {
     Serial.println("LoRa init FAILED. Check wiring.");
     while (1);
   }
 
   Serial.println("LoRa init OK");
   LoRa.receive();
   Serial.println("=== READY ===");
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
 
     Serial.print("Received: [");
     Serial.print(incoming);
     Serial.print("] RSSI: ");
     Serial.print(LoRa.packetRssi());
     Serial.println(" dBm");
 
     if (incoming.startsWith("PING:")) {
       Serial.println("PING matched → sending PONG");
       sendPong(incoming);
     } else if (incoming.startsWith("SOS:")) {
       Serial.println("!!! SOS RECEIVED !!!");
     }
   }
 }
 
 // ── Transmit helpers ────────────────────────────────────────────────────────
 void sendPing() {
   msgCount++;
   String packet = "PING:HUB-01:MSG#" + String(msgCount);
 
   LoRa.beginPacket();
   LoRa.print(packet);
   int result = LoRa.endPacket();
   LoRa.receive();
 
   Serial.print("Ping sent → "); Serial.print(packet);
   Serial.print(" | TX: "); Serial.println(result == 1 ? "OK" : "FAILED");
 }
 
 void sendSOS() {
   msgCount++;
   String packet = "SOS:HUB-01:MSG#" + String(msgCount);
 
   LoRa.beginPacket();
   LoRa.print(packet);
   int result = LoRa.endPacket();
   LoRa.receive();
 
   Serial.print("SOS sent → "); Serial.print(packet);
   Serial.print(" | TX: "); Serial.println(result == 1 ? "OK" : "FAILED");
 }
 
 void sendPong(String incoming) {
   String packet = "PONG:HUB-01";
 
   LoRa.beginPacket();
   LoRa.print(packet);
   int result = LoRa.endPacket();
   LoRa.receive();
 
   Serial.print("PONG sent | TX: ");
   Serial.println(result == 1 ? "OK" : "FAILED");
 }