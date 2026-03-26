/*
 * ResqBand — Hub Node
 *
 * Listens for PING and SOS packets from Rangers and prints structured output
 * to Serial so the Python server (server.py) can parse it.
 *
 * Output format — always "Packet" line first so the parser can use it as
 * a reliable block delimiter:
 *
 *   Packet  : PING:RANGER-01:MSG#5
 *   RSSI    : -90 dBm
 *   =============================
 *
 *   Packet  : SOS:RANGER-01:MSG#6
 *   RSSI    : -88 dBm
 *   SOS Alert received from Ranger
 *   =============================
 */

#include <SPI.h>
#include <LoRa.h>

// ── Pin config ──────────────────────────────────────────────────────────────
#define LORA_SS    5
#define LORA_RST   14
#define LORA_DIO0  2

// ── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);
  if (!LoRa.begin(433E6)) {
    Serial.println("LoRa init failed!");
    while (1);
  }

  Serial.println("Hub ready. Listening for PING / SOS...");
}

// ── Loop ────────────────────────────────────────────────────────────────────
void loop() {
  int packetSize = LoRa.parsePacket();
  if (!packetSize) return;

  String incoming = "";
  while (LoRa.available()) {
    incoming += (char)LoRa.read();
  }
  int rssi = LoRa.packetRssi();

  // ── Print structured block ───────────────────────────────────────────────
  // "Packet" always comes first — this is the parser's block start marker.
  Serial.print("Packet  : ");
  Serial.println(incoming);

  Serial.print("RSSI    : ");
  Serial.print(rssi);
  Serial.println(" dBm");

  // Extra human-readable line for SOS only
  if (incoming.startsWith("SOS:")) {
    Serial.println("SOS Alert received from Ranger");
  }

  Serial.println("=============================");
}
