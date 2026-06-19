FROM evoapicloud/evolution-api:v2.3.7

# p2 patch: rimuove il blocco historySyncConfig + version dal companion object
# in generateRegistrationNode (lib/Utils/validate-connection.js). I due field
# sono additions di Baileys 7.0.0-rc.9 (assenti in 6.7.18) e contengono valori
# hardcoded che il primary device WhatsApp non riconosce → primary fallisce la
# validazione del companion → server accetta companion_finish IQ ma NON pusha
# pair-success → Evolution riporta 401 loggedOut. Causa root del 401 in prod.
#
# Verificato empiricamente con MRE Baileys 7.0.0-rc.9 puro su numero healthy:
#   - 7.x stock         → "errore di collegamento" phone-side, no pair-success
#   - 7.x senza i field → pair-success in ~14s identico a 6.7.18 (success case)
#
# Il p1 (passive:true→false) era basato su diagnosi Codex iniziale poi smentita
# dalla riproduzione empirica; rimosso. Lasciamo passive:true stock — è il
# comportamento noto-buono in 6.x (e Baileys lo usa per il login post-pair).

RUN BAILEYS_FILE=/evolution/node_modules/baileys/lib/Utils/validate-connection.js \
 && sed -i '/^        historySyncConfig: {$/,/^        }$/d' "$BAILEYS_FILE" \
 && if grep -q "historySyncConfig" "$BAILEYS_FILE"; then echo "FAIL: historySyncConfig still present"; exit 1; fi \
 && if grep -q "primary: 10," "$BAILEYS_FILE"; then echo "FAIL: hardcoded version still present"; exit 1; fi \
 && echo "p2 PATCH OK"
