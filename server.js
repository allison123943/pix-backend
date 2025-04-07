// Importação de módulos necessários
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');

// Configuração inicial do Express
const app = express();
app.use(cors()); // Habilita CORS para todas as rotas
app.use(express.json()); // Permite parsing de JSON no corpo das requisições

// Credenciais e configurações do Mercado Pago
const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

// Configura o SDK do Mercado Pago com o access token
mercadopago.configure({ access_token: ACCESS_TOKEN });

// Configuração do Nodemailer para envio de emails (usando Gmail)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com', // Email do remetente
    pass: 'hrirzodqitdzwvrb' // Senha de app específica
  }
});

// Mapeamento de planos para arquivos PDF correspondentes
const planos = {
  normal: 'instrucoesAssistenteFinanceiro.pdf',
  casal: 'instrucoesassistentefinanceiroplanocasal.pdf',
  familia: 'instrucoesassistentefinanceiroplanofamilia.pdf'
};

// Função para verificar a assinatura do webhook
function verifySignature(req, secret) {
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret)
                     .update(JSON.stringify(req.body))
                     .digest('hex');
  return signature === hash;
}

// Rota do webhook para processar notificações de pagamento
app.post('/webhook', async (req, res) => {
  try {
    // Verificação de segurança (implementar em produção)
    // if (!verifySignature(req, WEBHOOK_SECRET)) {
    //   return res.status(401).send('Assinatura inválida');
    // }

    const event = req.body;
    console.log('📩 Webhook recebido:', event.type);

    // Processa apenas eventos de pagamento
    if (event.type === 'payment' && event.data?.id) {
      const paymentId = event.data.id;

      // Consulta detalhes do pagamento na API do Mercado Pago
      const paymentInfo = await mercadopago.payment.get(paymentId);
      console.log(`💰 Status do pagamento ${paymentId}:`, paymentInfo.body.status);

      // Verifica se o pagamento foi aprovado
      if (paymentInfo.body.status === 'approved') {
        const email = paymentInfo.body.payer.email;
        const item = paymentInfo.body.additional_info.items[0];
        
        // Extrai e normaliza o nome do plano
        const plano = item.title
          .replace('Plano ', '')
          .toLowerCase();

        // Valida se o plano existe
        const nomeArquivoPDF = planos[plano];
        if (!nomeArquivoPDF) {
          throw new Error(`Plano '${plano}' não encontrado`);
        }

        // Monta caminho absoluto para o arquivo PDF
        const pdfPath = path.join(__dirname, nomeArquivoPDF);
        console.log(`📄 Enviando PDF: ${pdfPath}`);

        // Configuração do e-mail com anexo
        const mailOptions = {
          from: 'oficialfinanzap@gmail.com',
          to: email,
          subject: '✅ Seu material exclusivo chegou!',
          text: `Olá!\n\nAqui está seu guia do ${item.title}.\n\nAgradecemos sua compra!`,
          attachments: [{
            filename: nomeArquivoPDF,
            path: pdfPath,
            contentType: 'application/pdf'
          }]
        };

        // Envio do e-mail com tratamento de erros
        try {
          await transporter.sendMail(mailOptions);
          console.log(`📧 E-mail enviado para: ${email}`);
        } catch (emailError) {
          console.error('❌ Erro no envio do e-mail:', emailError);
          throw new Error('Falha no envio do e-mail');
        }

        res.status(200).json({ 
          status: 'sucesso', 
          message: 'Pagamento confirmado e PDF enviado' 
        });
      } else {
        res.status(200).json({ 
          status: 'pendente', 
          message: 'Pagamento ainda não aprovado' 
        });
      }
    } else {
      res.status(200).json({ 
        status: 'ignorado', 
        message: 'Tipo de evento não suportado' 
      });
    }
  } catch (error) {
    console.error('🔥 Erro crítico no webhook:', error);
    res.status(500).json({ 
      status: 'erro', 
      message: 'Falha no processamento',
      detalhes: error.message 
    });
  }
});

// Rota para criação de novo pagamento PIX
app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;

    // Validação básica dos dados
    if (!email || !plano) {
      return res.status(400).json({ 
        error: 'Dados incompletos' 
      });
    }

    // Gera identificadores únicos
    const idempotencyKey = uuidv4(); // Previne duplicações
    const externalReference = uuidv4(); // Para reconciliação

    // Configuração do pagamento
    const paymentData = {
      statement_descriptor: 'Finanzap',
      transaction_amount: 1.00, // Valor para testes
      description: `Assinatura ${plano}`,
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: externalReference,
      additional_info: {
        items: [{
          id: 'finanzap_001',
          title: `Plano ${plano}`,
          description: 'Acesso completo à plataforma',
          category_id: 'services',
          quantity: 1,
          unit_price: 1.00
        }]
      },
      payer: {
        email: email,
        first_name: 'Cliente',
        last_name: 'Finanzap',
        identification: {
          type: 'CPF',
          number: '12345678909' // Genérico para testes
        }
      }
    };

    // Cria o pagamento na API do Mercado Pago
    const response = await mercadopago.payment.create(paymentData);
    
    // Extrai dados relevantes da resposta
    const payment = response.body;
    const qrData = payment.point_of_interaction?.transaction_data;

    res.status(200).json({
      paymentId: payment.id,
      qrCode: qrData?.qr_code,
      qrCodeBase64: qrData?.qr_code_base64,
      status: payment.status
    });

  } catch (error) {
    console.error('💥 Erro na criação do pagamento:', error);
    res.status(500).json({ 
      error: 'Erro no processamento',
      detalhes: error.message 
    });
  }
});

// Rota para verificar status do pagamento
app.get('/status-pagamento/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;

    // Consulta o pagamento na API do Mercado Pago
    const paymentInfo = await mercadopago.payment.get(paymentId);
    const { status, status_detail } = paymentInfo.body;

    res.status(200).json({
      status: status,
      detalhes: status_detail
    });

  } catch (error) {
    console.error('🔍 Erro na consulta do pagamento:', error);
    res.status(500).json({ 
      error: 'Erro na consulta',
      detalhes: error.message 
    });
  }
});

// Inicialização do servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor operacional na porta ${PORT}`);
});

// Considerações importantes:
// 1. Segurança: Substituir credenciais por variáveis de ambiente
// 2. Validações: Implementar verificação de assinatura no webhook
// 3. Dados reais: Atualizar valores monetários e dados do pagador
// 4. Logs: Implementar sistema de logs persistente
// 5. Tratamento de erros: Melhorar recuperação de falhas
// 6. Escalabilidade: Adicionar filas para processamento assíncrono