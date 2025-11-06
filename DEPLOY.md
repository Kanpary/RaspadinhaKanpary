# Guia de Deploy - RaspadinhaKanpary

## ✅ Pré-requisitos

1. **Chaves BullsPay**
   - Acesse: https://gateway.bullspay.com.br
   - Faça login
   - Vá em "API" → "Gerar novo Token"
   - Copie `client_id` e `api_key`

2. **Conta Render**
   - Criar conta em: https://render.com
   - Conectar GitHub/GitLab

## 📦 Deploy no Render

### Passo 1: Criar PostgreSQL Database

1. No Render Dashboard → "New" → "PostgreSQL"
2. Nome: `raspadinha-db`
3. Plan: Free (ou Starter para produção)
4. Região: Oregon (US West)
5. Criar database

**IMPORTANTE:** Copie a `Internal Database URL` que será usada no próximo passo.

### Passo 2: Criar Web Service

1. No Render Dashboard → "New" → "Web Service"
2. Conectar seu repositório
3. Configurações:
   - **Name**: `raspadinha-kanpary`
   - **Region**: Oregon (US West)
   - **Branch**: `main`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node src/index.js`
   - **Plan**: Free (ou Starter para produção)

### Passo 3: Configurar Variáveis de Ambiente

No Web Service, ir em "Environment" e adicionar:

```
DATABASE_URL=postgresql://...  (copiar da Internal Database URL do passo 1)
BULLSPAY_CLIENT_ID=bp_client_sua_chave_aqui
BULLSPAY_API_KEY=bp_secret_sua_chave_aqui
JWT_SECRET=gerar_string_aleatoria_minimo_32_caracteres
PORT=5000
```

**Gerar JWT_SECRET seguro:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Passo 4: Deploy

1. Clicar em "Create Web Service"
2. Aguardar build e deploy (5-10 minutos)
3. Após sucesso, copiar URL: `https://seu-app.onrender.com`

### Passo 5: Configurar Webhook BullsPay

1. Acessar: https://gateway.bullspay.com.br
2. Ir em "Webhooks"
3. Criar novo webhook:
   - **URL**: `https://seu-app.onrender.com/webhook/bullspay`
   - **Transaction Events**: ✅ Ativado
   - **Withdrawal Events**: ✅ Ativado
4. Salvar

### Passo 6: Criar Primeiro Admin

1. Acessar seu app: `https://seu-app.onrender.com`
2. Fazer cadastro normalmente
3. No Render, ir em PostgreSQL Database → "Connect" → "PSQL Command"
4. Executar:
```sql
UPDATE users SET is_admin = true WHERE email = 'seu@email.com';
```

## 🧪 Testar Aplicação

### Funcionalidades para testar:

1. **Autenticação**
   - ✅ Cadastro (username, email, senha, CPF)
   - ✅ Login
   - ✅ Logout

2. **Depósito**
   - ✅ Criar depósito
   - ✅ Ver QR Code
   - ✅ Verificação automática (a cada 5 segundos)
   - ✅ Saldo creditado após pagamento

3. **Saque**
   - ✅ Solicitar saque
   - ✅ Verificação automática
   - ✅ Devolução de saldo se falhar

4. **Raspadinha**
   - ✅ Jogar raspadinha
   - ✅ Animação automática
   - ✅ Prêmios creditados
   - ✅ Histórico de jogadas

5. **Admin** (requer is_admin = true)
   - ✅ Configurar RTP
   - ✅ Ver saldo BullsPay
   - ✅ Listar transações
   - ✅ Reembolsar transações
   - ✅ Ver transações BullsPay
   - ✅ Ver saques BullsPay

## ⚙️ Configurações Pós-Deploy

### Ajustar RTP (Admin)
1. Login como admin
2. Acessar painel admin
3. Configurar RTP desejado (50% a 99%)
4. Padrão: 95%

### Monitorar Logs
No Render Dashboard → Web Service → "Logs"

### Monitorar Database
No Render Dashboard → PostgreSQL → "Info"

## 🔒 Segurança

### Já implementado:
- ✅ Senhas hashadas com bcrypt
- ✅ JWT para autenticação
- ✅ HTTPS automático no Render
- ✅ Validação de CPF
- ✅ Transações atômicas
- ✅ Middleware de proteção
- ✅ Saldo não pode ficar negativo

### Recomendações adicionais:
- Usar plan pago do Render para SSL dedicado
- Configurar rate limiting (opcional)
- Backup regular do database
- Monitorar logs de erro

## 🐛 Troubleshooting

### Servidor não inicia
- Verificar se todas as variáveis de ambiente estão configuradas
- Verificar logs no Render
- Verificar se DATABASE_URL está correto

### Database não conecta
- Verificar DATABASE_URL
- Verificar se PostgreSQL está rodando
- Verificar região (deve ser a mesma do Web Service)

### Webhook não funciona
- Verificar URL do webhook no BullsPay
- Verificar logs do servidor
- Testar manualmente: `POST https://seu-app.onrender.com/webhook/bullspay`

### Login não funciona
- Limpar localStorage do navegador
- Verificar se JWT_SECRET está configurado
- Verificar logs

## 📊 Monitoramento

### Métricas importantes:
- Taxa de conversão de depósitos
- RTP real vs configurado
- Taxa de falha de saques
- Tempo de resposta da API

### Logs importantes:
- Erros de autenticação
- Falhas de transação BullsPay
- Erros de database
- Webhooks recebidos

## 🚀 Melhorias Futuras

1. **Performance**
   - Adicionar Redis para cache
   - Otimizar queries do banco
   - CDN para assets estáticos

2. **Funcionalidades**
   - Mais tipos de jogos
   - Sistema de bônus
   - Programa de afiliados
   - Ranking de jogadores

3. **Admin**
   - Dashboard com gráficos
   - Relatórios exportáveis
   - Gestão de usuários
   - Logs de auditoria

## 📞 Suporte

- Documentação BullsPay: https://bullspay.dev-doc.online/
- Suporte Render: https://render.com/docs
- Issues no GitHub: (adicionar link do seu repositório)
