# Instruções para agentes

As regras deste repositório estão em [`CLAUDE.md`](CLAUDE.md) e valem para qualquer agente: leia-o inteiro antes
de mudar código (restrições de privacidade, memória, determinismo, repositório público e definição de pronto).

Para mudar ou recriar a interface, leia também [`docs/INTERFACE.md`](docs/INTERFACE.md): fronteira com o
processamento, restrições da tela e os comportamentos que não podem se perder.

Antes de propor a mudança: `npm run test`, `npm run lint` e `npm run build` passando. Trabalhe numa branch e
abra um PR; não versione nada de `local/`.
