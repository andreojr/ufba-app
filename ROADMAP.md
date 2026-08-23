# Roadmap — v1 "redondinha" (uso diário)

Lista de próximos passos para deixar o app pronto pro dia-a-dia. Anotado em 2026-08-19.

---

## Decisão de foco — 2026-08-22

Com os itens 2, 3, 4, 6, 7, 8 e 9 entregues, o roadmap virou uma lista plana de
coisas boas sem ordem de ataque. Decidido **concentrar o próximo ciclo em 3
features** e tratar todo o resto como incremental.

### As 3 do ciclo

| # | Feature | Item |
|---|---|---|
| A | **Seleção de optativas** | item 5 |
| B | **Pontos de atenção (provas e trabalhos)** | item 13 (novo) |
| C | **Turma virtual — página própria por matéria** | item 1 |

### Por que essas três

- **Fecham as três perguntas que o aluno faz sozinho hoje.** "O que eu escolho
  cursar?" (A), "o que vence essa semana?" (B), "o que o professor postou?" (C).
  O app já responde bem o retrospectivo (histórico, CR, trajetória, grade) e não
  responde nada do prospectivo. É o buraco maior.
- **B e C dividem a mesma fundação.** Ambas dependem do acesso à Turma Virtual
  mapeado em [TURMA_VIRTUAL_INVESTIGATION.md](TURMA_VIRTUAL_INVESTIGATION.md) —
  postback de entrada, navegação `seção → Principal → seção`, parsing das
  entidades numéricas. Fazer as duas no mesmo ciclo amortiza esse scraping uma
  vez só; fazer em ciclos separados paga o custo de reentrada duas vezes.
- **A não depende de nada que falte.** O catálogo de cursos e matérias (item 3)
  já está no banco e a Trajetória (item 4) já é o destino natural das optativas
  escolhidas. É a feature de maior valor com o menor caminho até ela.
- **B é o dado que existe agora.** A varredura de 19/08 achou Avaliações
  populadas em 5 das 6 turmas, contra **uma única notícia** no semestre inteiro.
  A lousa só enche ao longo do semestre; as datas de prova já estão lá.

### Por que o resto fica incremental

Não é descarte — é ordem. Os itens 10, 11 e 12 caem em uma de três categorias:

- **Dependem de decisão de produto ainda aberta** (11 — push exige credencial
  guardada no servidor, o que colide com quem escolheu `syncMode: "device"`).
- **Dependem de terceiros fora do SIGAA** (10 — Moodle e Google Classroom, cada
  um com sua própria integração e seu próprio risco).
- **Formato ainda em aberto** (12 — o recurso visual de impacto no CR precisa ser
  discutido antes de implementar).

Nenhum deles bloqueia A, B ou C, e nenhum tem prazo. Entram conforme surgir
espaço, um de cada vez, sem virar frente de trabalho paralela.

### Consequências assumidas

- **Sem push neste ciclo.** B mostra prazos quando o app abre; não avisa sozinho.
  A notificação (item 11) continua sendo o passo seguinte natural de B, não parte
  dela.
- **C entrega só a Fase 1 da investigação** — Notícias, Avaliações e cronograma
  de tópicos, que são os três validáveis com HTML real hoje. Tarefas, Arquivos e
  Fóruns ficam fora até existir fixture real, pelo mesmo motivo que o
  `boletim.ts` segue com `NotImplementedException`.
- **Cada uma das três merece spec e plano próprios** em `docs/superpowers/`,
  antes de código.

---

## 1. Página própria por matéria — 🎯 foco do ciclo (C)
- Baseado na investigação em [TURMA_VIRTUAL_INVESTIGATION.md](TURMA_VIRTUAL_INVESTIGATION.md).
- Cada matéria ganha sua própria tela (hoje só existe a visão agregada).

## 2. Persistência estruturada dos dados do SIGAA ✅ feito
- Hoje os dados são baixados do SIGAA a cada abertura do app — trocar por persistência real no banco.
- Adicionar botão em Ajustes para re-sync manual sob demanda do usuário.

## 3. Catálogo de cursos e matérias no banco ✅ feito
- Persistir todos os cursos e as matérias que cada curso pode cursar (base para trajetória e optativas, itens 3 e 5).

## 4. Página de Trajetória ✅ feito
- Tabs no topo da página, cada tab dá foco a um insight específico:
  - **CR** — gráfico de **linha** do CR por período; notas aparecem ao lado de cada matéria na trajetória.
    - Com CR selecionado, cada matéria mostra ao lado uma métrica: CR com todas as matérias − CR sem a matéria X = impacto daquela matéria no CR. Mostrar como seta (↑/↓) + número.
  - **Carga horária** — gráfico de **barras** da carga horária por período; mostrar apenas as horas de cada matéria (sem notas).
- Grid da trajetória muda de "período embaixo de período" para "ano embaixo de ano", com os 2 períodos de cada ano lado a lado.
- Linhas conectando os períodos em ordem cronológica, terminando num card de "linha de chegada".

## 5. Seleção de optativas — 🎯 foco do ciclo (A)
- Tela de busca/seleção de matérias optativas (usa o catálogo do item 3).
- Matérias escolhidas aparecem automaticamente em "Minha Trajetória".
- Ao cadastrar as matérias no banco, levantar tags brutas relacionando cada matéria à sua área de estudo — usadas como filtro por área nessa tela.

## 6. Header global + remoção da tab de Ajustes ✅ feito
- Remover "Ajustes" das tabs inferiores.
- Header com foto de perfil + ícone de engrenagem (configurações) fica global em todas as páginas.

## 7. Página de professores (perfil, não avaliação) ✅ feito
- Baseado na investigação em [PROFESSORES_INVESTIGATION.md](PROFESSORES_INVESTIGATION.md).
- Descartada a ideia de avaliação (evitar atrito/problema com os professores).
- O SIGAA já disponibiliza um perfil de cada professor, só que praticamente ninguém sabe que existe. Página pública, nem precisa de login: https://sigaa.ufba.br/sigaa/public/docente/busca_docentes.jsf
- Nova aba/página listando os professores do semestre atual do usuário, mostrando esse perfil do SIGAA — democratizando a informação além de só o nome.

## 8. Marcos de semestralização na barra de progresso da Trajetória ✅ feito
- Depende do item 3 (catálogo de cursos e matérias no banco): com a grade curricular de cada curso persistida, dá pra saber quantos semestres o curso originalmente prevê e quantas horas cada um desses semestres soma.
- Com isso, a barra de progresso de carga horária do curso (item 4) ganha linhas de referência marcando a carga horária acumulada esperada ao final de cada semestre da grade original.
- Comparando a carga horária que a pessoa já cursou contra essas marcas dá pra dizer se ela está "semestralizada" (no ritmo previsto pela grade) ou adiantada/atrasada em relação a ela.
- Resolve o curso do aluno pelo campo "Curso:" do próprio Histórico (novo `Historico.nomeCurso`), sem depender do sync de horário. Sempre usa a estrutura curricular "Ativa" atual (evita scraping por versão de currículo) — matérias do histórico que não batem com a grade atual ganham um badge "Fora da grade atual" ou "Equivale a X" no card da matéria, em vez de tentar resolver a grade histórica exata do aluno.

## 9. Grafo de pré-requisitos ao clicar numa matéria da Trajetória ✅ feito
- Depende do item 3 (catálogo de cursos e matérias no banco): precisa das relações de pré-requisito entre matérias persistidas.
- Ao clicar numa matéria na grid da Trajetória, abre um modal com o grafo da árvore de dependências daquela matéria (pré-requisitos e, se fizer sentido, o que ela desbloqueia).
- Matéria clicada em destaque no grafo; navegar pela árvore ajuda a entender por que uma matéria específica ainda está bloqueada.
- **Entregue como "vizinhos curriculares"**, não como grafo SVG: o grafo crashava no Android com grade grande, e a navegação em cascata (pré-requisitos diretos + o que desbloqueia, em linha do tempo) respondeu a mesma pergunta sem o custo de layout. Spec em [docs/superpowers/specs/2026-08-22-vizinhos-curriculares-design.md](docs/superpowers/specs/2026-08-22-vizinhos-curriculares-design.md).

## 10. Vincular Moodle e Google Classroom — incremental
- Nem todo professor posta material só na turma virtual do SIGAA — muitos usam Moodle ou Google Classroom em paralelo, e isso fica fora do radar do app.
- Investigar vínculo com essas plataformas (login/integração) para trazer avisos, materiais e atividades de lá também, unificando com o que já vem do SIGAA.

## 11. Sistema de notificações (integração com o SIGAA) — incremental, decisão de arquitetura tomada
- Objetivo: avisar o usuário quando sair novidade no SIGAA (notas, formatura, etc.), sem precisar abrir o app pra descobrir.
- Restrição inegociável: **não guardar senha do aluno no servidor** — senha fica só no SecureStore do device. SIGAA não permite consulta em lote, só por aluno autenticado.
- Descartado (a) cron client-side puro (`expo-background-task`/background-fetch) — pouco confiável, principalmente no iOS, já que o SO reduz wake-ups de apps com uso esporádico.
- Descartado (b) servidor centralizado fazendo a consulta em lote — exigiria guardar senha de todos os alunos no servidor.
- **Decisão: push silencioso (data-only) como gatilho.**
  1. Servidor guarda só o push token de cada device (EAS Push Service / Expo Notifications) — nenhuma credencial.
  2. Cron simples no backend (ex: a cada 1h) dispara push silencioso (content-available / data message) pra todos os tokens — broadcast puro, sem lógica de negócio nem acesso ao SIGAA.
  3. App recebe o push em background, pega a senha do SecureStore, loga no SIGAA e verifica novidade.
  4. Se houver novidade, dispara notificação local (visível) pro usuário.
- Vantagens: servidor nunca vê senha; timing mais confiável que background fetch passivo (quem decide quando rodar é o servidor); custo de servidor baixo; consumo de bateria desprezível.
- Limitações: push silencioso no iOS não é 100% garantido (pode atrasar/ser descartado em Low Power Mode ou se o app foi force-quit) — vale complementar com sync manual (pull to refresh) e ser transparente na UX sobre possíveis atrasos.
- Precisa configurar handler de notificação em background no Android (AndroidManifest) e no iOS (capabilities de background push).
- Ferramentas: `expo-notifications` (client), EAS Push Service (sem push server próprio), cron simples no backend (Vercel Cron, Supabase Edge Function, etc.) só pro broadcast.

## 12. Insights de CR: impacto por semestre/matéria — incremental
- Depende do item 4 (Página de Trajetória ✅) e da divisão dos gráficos entre as tabs CR e Carga Horária em Insights.
- O gráfico de linha do CR por período continua existindo, só que hoje mora na página Insights (não mudou de lugar por conta disso).
- O que foi removido foi a métrica que cada card de matéria mostrava em Trajetória: CR com todas as matérias − CR sem a matéria X = impacto daquela matéria no CR (seta ↑/↓ + número), do item 4 original.
- Trazer essa percepção de volta, mas na tab CR de Insights — precisa de um recurso visual próprio pra "o quanto cada semestre/matéria pesou no CR" (não é mais um selo por card, já que os cards de matéria não vivem mais nessa página). Formato ainda em aberto — discutir opções antes de implementar.

## 13. Pontos de atenção: provas e trabalhos — 🎯 foco do ciclo (B)
- Baseado na investigação em [TURMA_VIRTUAL_INVESTIGATION.md](TURMA_VIRTUAL_INVESTIGATION.md); antes existia só como sub-item da Fase 1 dela, sem entrada própria no roadmap.
- Superfície agregada com o que tem data marcada e ainda não passou: **Avaliações** (`/sigaa/ava/DataAvaliacao/listar.jsf`) e, quando houver fixture real, **Tarefas**.
- Corta transversalmente as matérias — não é a página de uma disciplina (isso é o item 1), é "o que vence primeiro", independente de turma.
- Dado disponível hoje: a varredura de 19/08 achou avaliação marcada em 5 das 6 turmas (21/10, 06/10, 22/09, 02/12), contra uma única notícia no semestre inteiro. É a parte da Turma Virtual que já tem conteúdo antes do semestre andar.
- Depende do mesmo acesso à Turma Virtual do item 1 — daí os dois estarem no mesmo ciclo.
- Sem push nesta etapa: mostra os prazos quando o app abre. O aviso ativo é o item 11.
