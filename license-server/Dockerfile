# Servidor de licenças do GATES! TV (sem dependências).
#   docker build -t gates-licencas license-server
#   docker run -p 8787:8787 --env-file license-server/.env -v gates-dados:/app/data gates-licencas
# A chave privada NÃO vai na imagem: passe LICENSE_PRIVATE_KEY no .env (conteúdo do PEM, com \n)
# ou copie data/license-private.pem para o volume. Sem ela, uma chave nova seria criada e os
# APKs já distribuídos deixariam de aceitar as licenças.
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN mkdir -p data && chown -R node:node /app
ENV PORT=8787 DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 8787
USER node
CMD ["node", "server.mjs"]
