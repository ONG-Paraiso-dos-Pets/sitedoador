# ONG Paraíso dos Pets · Página de Captação de Doadores

Landing page desenvolvida para captação de novos doadores e padrinhos da **ONG Paraíso dos Pets** em Ribeirão Preto (SP).

## 🐾 Funcionalidades

- **Formulário de Captação Rápida**: Coleta de apenas 3 campos fundamentais:
  - Nome completo (com validação de nome e sobrenome)
  - Telefone / Celular (máscara automática e validação de todos os DDDs válidos do Brasil segundo a ANATEL)
  - E-mail (validação de formato RFC)
  - Consentimento LGPD (autorização de contato para e-mail e WhatsApp)
  - Envio direto para o backend serverless no **Neon Functions** e gravação no **Lakebase Postgres**
- **Painel Administrativo (`admin.html`)**:
  - Acesso protegido por autenticação via **Neon Auth (Managed Better Auth)**
  - Tabela com filtros de status (*Aguardando*, *Contatados*, *Doadores Ativos*, *Arquivados*) e busca em tempo real
  - **Botão Chamar no WhatsApp**: Abre a conversa com mensagem personalizada de acolhimento e atualiza o status do doador para "Contatado" automaticamente
  - Gestão de equipe: qualquer administrador pode convidar novos e-mails ou remover membros
- **Visualização Institucional**:
  - Seção com informações sobre o trabalho e missão da ONG
  - Galeria com fotos reais dos cães resgatados que vivem no abrigo
- **Front-end Moderno e Acessível**:
  - HTML5 semântico com suporte a leitores de tela e ARIA
  - CSS3 responsivo com tipografia fluida na família `Inter`
  - JavaScript Vanilla modular, sem dependências externas pesadas

## 🚀 Como Executar

Basta abrir o arquivo `index.html` em qualquer navegador web moderno:

```bash
open index.html
```

Ou subir um servidor estático local:

```bash
npx serve .
```

## 📄 Licença e Direitos

Projeto desenvolvido para a ONG Paraíso dos Pets · Ribeirão Preto, SP.
