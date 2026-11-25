<div align="center">

<img src="public/favicon.svg" alt="" width="72" height="72">

# AuditAnalyzer

**Plataforma de análises contábeis do TOTVS Protheus, 100% no navegador.**

Cada ferramenta lê o seu tipo de extração, reconcilia linha a linha, responde às perguntas de auditoria interna/SOX
e gera um papel de trabalho em Excel pronto para revisão.

[![Publicar no GitHub Pages](https://github.com/Carlosdanyell/AuditAnalyzer/actions/workflows/pages.yml/badge.svg)](https://github.com/Carlosdanyell/AuditAnalyzer/actions/workflows/pages.yml)
![Versão](https://img.shields.io/badge/vers%C3%A3o-2.5.0-0f2742)
![Processamento local](https://img.shields.io/badge/dados-100%25%20locais-1d7a46)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-1e6495?logo=typescript&logoColor=white)
![React 18](https://img.shields.io/badge/React-18-1e6495?logo=react&logoColor=white)

[**Abrir o aplicativo**](https://carlosdanyell.github.io/AuditAnalyzer/) ·
[Manual do usuário](public/ajuda.html) ·
[Plataforma e módulos](docs/MODULOS.md) ·
[Histórico de versões](CHANGELOG.md)

</div>

---

> [!IMPORTANT]
> **Nenhum dado sai do computador.** Não há servidor, analytics, CDN nem fontes externas: o aplicativo é um conjunto
> de arquivos estáticos e a política de segurança do navegador (`connect-src 'self'`) bloqueia qualquer envio.
> Os dados ficam só na memória da sessão; o IndexedDB guarda apenas a configuração, as justificativas e as
> preferências da tela.

## Ferramentas

| Ferramenta | Lê | Situação |
|---|---|---|
| **Log de auditoria** (`CFGR700`) | Relatório CFGR700 do Protheus (tabela CT2), um ou mais `.xlsx` de até ~1 milhão de linhas | Em uso desde a 1.0.0 |
| **Integridade da CT2** (`CT2`) | Extração da tabela CT2 (lançamentos), um ou mais `.xlsx` ou o XML que o Protheus gera (também em `.zip`), até um ano por exportação | Em uso desde a 2.1.0 |
| **Conciliador** (`CONC`) | Relatório de origem da folha (GPER040, TXT do spool) e razão analítico (CTBR400, TXT ou XML), com o perfil de contas importado na Configuração | Prévia na 2.5.0 (folha de pagamento) |
| **Plano de contas** (`CT1`) | CSV do plano de contas exportado do Protheus (tabelas CT1 + CVD) | Prévia (não publicado) |

A plataforma recebe outras ferramentas contábeis (por exemplo, conciliações) pelo mesmo contrato
([`docs/MODULOS.md`](docs/MODULOS.md)): cada uma traz as próprias regras, telas e planilha e usa a casca, a marca, a
leitura em fluxo, a rastreabilidade e as verificações comuns.

## O que cada ferramenta responde

**Log de auditoria (CFGR700)**

| Pergunta de auditoria | Onde aparece |
|---|---|
| Quais lançamentos e documentos foram **excluídos**, **alterados**, **postados** ou estão **desbalanceados** no período? | Painel e Resumo, por origem (manual, automático, misto) |
| A alteração mudou conteúdo ou foi só efetivação/carimbo de usuário? | Critério de corte das alterações |
| O que ocorreu em **pré-lançamento (9)** e o que ocorreu **após a postagem (1)**? | Modo **Segregado** e aba Segregacao |
| O mesmo usuário incluiu e efetivou o documento? | Segregação de funções, por documento |
| Todo documento excluído ou alterado tem justificativa? | Justificativas, com cobertura por arquivo e período |
| Nada ficou de fora? | Reconciliação de linhas, eventos e 15 invariantes verificados a cada execução |

**Integridade da CT2**

| Pergunta de auditoria | Onde aparece |
|---|---|
| A extração está completa e legível? | Reconciliação de linhas por arquivo, valores e chaves legíveis, colunas encontradas |
| Débito = crédito em cada documento, lote e dia, por tipo de saldo e moeda? | Testes B1–B3; B4/B5 indicam a compensação pelo documento vizinho |
| Há linhas incoerentes, duplicadas, fora do período ou em dia não útil? | Testes I1–I5 e E1–E6, com a lista de exceções |
| Os lançamentos respeitam o cadastro das contas: centro de custo e filial (item contábil) obrigatórios informados, nenhuma entidade em conta que não aceita? | C1–C5, com o plano de contas carregado junto com a extração, conferindo cada lado do lançamento |
| Um lançamento automático foi alterado depois de gerado? Há lançamento sem efeito contábil? | I4a (valor diferente do "Valor Moeda1", para conferir com o documento de aprovação) e I3b (mesma conta e mesmas entidades) |
| Quais documentos são manuais, automáticos ou mistos, e quais lotes tiveram intervenção manual? | Origem do documento, no **Painel** e na planilha |
| Como se distribuem os lançamentos por rotina, por dia, lançamento padrão e origem? | **Painel** de composição, Perfil (P1–P4) e os 10 maiores documentos |
| O que precisa ser verificado, e por quê? | **Achados**: cada ocorrência com o motivo e o documento aberto ao lado |
| A planilha prova os números sozinha? | Papel de trabalho **amarrado por fórmulas**: mudar a tolerância ou o período nos Critérios recalcula testes e status |

**Conciliador (folha de pagamento)**

| Pergunta de auditoria | Onde aparece |
|---|---|
| A folha foi lida inteira e o razão também? | Reconciliação: totais da folha (L), razão (R), tipos de saldo (T) e SHA-256 dos arquivos |
| Quanto cada conta contábil deveria ter recebido da folha? | Esperado por conta, calculado com as verbas do perfil |
| A integração contábil bate com a folha, filial por filial e verba por verba? | Integração (F1a–F1e): toda linha de integração comparada com a folha, em valores absolutos |
| Qual parte do saldo anterior foi baixada no mês? | Baixa do saldo anterior (F3), por combinação exata dos lançamentos |
| O saldo contábil fecha com o esperado? O que explica a diferença? | Ponte por conta e situação sugerida, sem limite de materialidade |
| A planilha prova os números sozinha? | Papel de trabalho **amarrado por fórmulas**, com "Confere" por conta |

**Plano de contas**

| Pergunta | Onde aparece |
|---|---|
| O arquivo está íntegro: cabeçalho, contas únicas, hierarquia sem ciclo, datas válidas? | Erros bloqueantes E01–E07, com a conta e a linha do arquivo; com erro, a planilha não é gerada |
| Toda analítica tem vínculo com o plano referencial (ECD)? Há CVD órfão ou repetido? | Alertas A01–A09 |
| Quantas contas por nível, tipo, natureza do saldo e natureza SPED? | Resumo da tela |
| A planilha Doc-01 sai no padrão? | Uma aba com a hierarquia agrupada por nível, sintéticas destacadas e códigos como texto |

## Como funciona

```mermaid
flowchart LR
    A["Extrações do Protheus<br/>(.xlsx)"] --> B["Leitura em fluxo<br/>ZIP → XML, SHA-256, CRC32"]
    B --> C["Base colunar<br/>typed arrays + dicionário"]
    C --> D["Motor da ferramenta<br/>CFGR700 · Integridade da CT2 · …"]
    D --> E["Verificações<br/>bloqueantes e alertas"]
    E --> F["Painel e tabelas"]
    E --> G["Papel de trabalho<br/>Excel (pt ou en)"]
```

Todo o processamento pesado roda em um **Web Worker**; a tela recebe só agregados e páginas de linhas, e continua
responsiva com arquivos de cerca de 1 milhão de linhas.

## Recursos

<table>
<tr>
<td width="50%" valign="top">

**Plataforma**
- Console: trilho com as visões, trilha, indicadores-chave da análise e barra de status
- Configuração própria de cada ferramenta e feriados comuns, com cópia de segurança única
- Aviso quando o arquivo parece ser de outra ferramenta
- Tema claro e escuro; fontes servidas pelo próprio app

**Leitura e integridade**
- SHA-256 de cada arquivo; CRC32 e tamanho de cada parte do ZIP
- Reconciliação: linhas após o cabeçalho − cabeçalhos repetidos − linhas em branco = linhas de detalhe
- Vários arquivos na mesma análise, com alerta de sobreposição e dias sem extração

</td>
<td width="50%" valign="top">

**Painel e tabelas**
- Cada número abre a tabela com exatamente aquelas linhas
- CFGR700: períodos, data de corte, modo **Geral** ou **Segregado**, sinalizações, justificativas
- CT2: Painel de composição (origem, rotina, dia), Achados com o motivo de cada ocorrência, filtros comuns
  (segmento, origem, rotina, lote, dia), painel lateral do documento e parâmetros reaplicados em segundos

**Papel de trabalho em Excel**
- Resumo vivo por fórmulas, critérios editáveis, exceções, dados e rastreabilidade
- Português ou inglês; datas como datas do Excel, valores em reais
- Verificação bloqueante impede a exportação sem confirmação registrada
- Mesma entrada + mesma configuração = mesma saída

</td>
</tr>
</table>

## Uso

1. Abra o [aplicativo](https://carlosdanyell.github.io/AuditAnalyzer/) no Chrome ou no Edge. Não há instalação.
2. Em **Ferramentas**, abra a análise; carregue uma ou mais extrações (`.xlsx`), em ordem cronológica, e clique em
   **Analisar**.
3. Confira a **Reconciliação** e navegue pelo **Painel** e pelas **Tabelas**; no CFGR700, registre as
   **Justificativas**; na Integridade da CT2, veja os **Achados**.
4. Clique em **Exportar planilha** e escolha o idioma (e, no CFGR700, o escopo).

O passo a passo de cada ferramenta está no [manual do usuário](public/ajuda.html), também disponível no botão
**Ajuda** do aplicativo.

## Desenvolvimento

Requer Node.js 20.19 ou superior.

```bash
npm ci
npm run dev         # servidor de desenvolvimento
npm run test        # testes com arquivos sintéticos (rodam no CI)
npm run test:e2e    # ponta a ponta no navegador (Playwright, build de produção)
npm run lint
npm run build       # build de produção para o GitHub Pages
```

`npm run test:local` roda os testes com os arquivos reais em `local/`, pasta que **não é versionada**: o repositório
é público e contém apenas dados sintéticos.

| Documento | Conteúdo |
|---|---|
| [`docs/MODULOS.md`](docs/MODULOS.md) | Plataforma de análises: contrato dos módulos e o que uma ferramenta nova traz |
| [`docs/REGRAS_CFGR700.md`](docs/REGRAS_CFGR700.md) | Regras de negócio e invariantes do log de auditoria |
| [`docs/REGRAS_CT2_INTEGRIDADE.md`](docs/REGRAS_CT2_INTEGRIDADE.md) | Regras, testes e planilha da Integridade da CT2 |
| [`docs/REGRAS_CONCILIADOR.md`](docs/REGRAS_CONCILIADOR.md) | Regras, perfil e planilha do Conciliador |
| [`docs/REGRAS_PLANO_DE_CONTAS.md`](docs/REGRAS_PLANO_DE_CONTAS.md) | Leitura, validações e planilha do Plano de contas |
| [`docs/ROTEIRO.md`](docs/ROTEIRO.md) | Fases de desenvolvimento e situação |
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Leitura em fluxo, armazenamento colunar, motor, exportação |
| [`docs/INTERFACE.md`](docs/INTERFACE.md) | Comportamentos obrigatórios das telas e padrão visual |
| [`docs/MEDICOES.md`](docs/MEDICOES.md) | Tempo e memória medidos |
| [`CLAUDE.md`](CLAUDE.md) | Restrições e convenções para quem contribui |

**Stack:** Vite · React 18 · TypeScript strict · Web Worker · TanStack Virtual · zod · hash-wasm · fflate ·
Vitest · Playwright. Fontes Sora, Geist e Geist Mono (SIL OFL, em `public/licencas`).

---

<div align="center">
<sub>Desenvolvido por Carlos Danyell</sub>
</div>
