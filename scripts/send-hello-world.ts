import { sendOutboundMessage } from "../src/main.ts";

const to = process.argv[2];

if (!to) {
  console.error(
    "Uso: node --experimental-transform-types --env-file-if-exists=.env scripts/send-hello-world.ts +5511999999999",
  );
  process.exit(1);
}

sendOutboundMessage
  .execute({ to, templateName: "hello_world", languageCode: "en_US", parameters: [] })
  .then((result) => {
    console.log("Mensagem enviada com sucesso:", result);
  })
  .catch((error: unknown) => {
    console.error("Falha ao enviar mensagem:", error);
    process.exit(1);
  });
