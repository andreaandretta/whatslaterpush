FROM evoapicloud/evolution-api:v2.3.7
RUN sed -i 's/passive: true/passive: false/g' \
    /evolution/node_modules/baileys/lib/Utils/validate-connection.js \
 && echo "PATCH OK" \
 && grep -c "passive: false" \
    /evolution/node_modules/baileys/lib/Utils/validate-connection.js
