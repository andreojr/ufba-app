# Roadmap — v1 "redondinha" (uso diário)

Lista de próximos passos para deixar o app pronto pro dia-a-dia. Anotado em 2026-08-19.

## 1. Página própria por matéria
- Baseado na investigação em [TURMA_VIRTUAL_INVESTIGATION.md](TURMA_VIRTUAL_INVESTIGATION.md).
- Cada matéria ganha sua própria tela (hoje só existe a visão agregada).

## 2. Persistência estruturada dos dados do SIGAA
- Hoje os dados são baixados do SIGAA a cada abertura do app — trocar por persistência real no banco.
- Adicionar botão em Ajustes para re-sync manual sob demanda do usuário.

## 3. Catálogo de cursos e matérias no banco
- Persistir todos os cursos e as matérias que cada curso pode cursar (base para trajetória e optativas, itens 3 e 5).

## 4. Página de Trajetória (ainda em definição, mas já com direção clara)
- Tabs no topo da página, cada tab dá foco a um insight específico:
  - **CR** — gráfico de **linha** do CR por período; notas aparecem ao lado de cada matéria na trajetória.
    - Com CR selecionado, cada matéria mostra ao lado uma métrica: CR com todas as matérias − CR sem a matéria X = impacto daquela matéria no CR. Mostrar como seta (↑/↓) + número.
  - **Carga horária** — gráfico de **barras** da carga horária por período; mostrar apenas as horas de cada matéria (sem notas).
- Grid da trajetória muda de "período embaixo de período" para "ano embaixo de ano", com os 2 períodos de cada ano lado a lado.
- Linhas conectando os períodos em ordem cronológica, terminando num card de "linha de chegada".

## 5. Seleção de optativas
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
