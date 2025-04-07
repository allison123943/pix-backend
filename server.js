/* [1] IMPORTAÇÕES E CONFIGURAÇÃO INICIAL */
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

/* [2] CONFIGURAÇÕES DE CHAVES E SERVIÇOS */
const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

mercadopago.configure({ access_token: ACCESS_TOKEN });

/* [3] CONFIGURAÇÃO DO SERVIÇO DE E-MAIL */
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'hrirzodqitdzwvrb'
  }
});

/* [4] MAPEAMENTO DE PLANOS PARA ARQUIVOS */
const planos = {
  normal: 'instrucoesAssistenteFinanceiro.pdf',
  casal: 'instrucoesassistentefinanceiroplanocasal.pdf',
  familia: 'instrucoesassistentefinanceiroplanofamilia.pdf'
};

/* [5] ROTA DE WEBHOOK - PROCESSAMENTO DE PAGAMENTOS */
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    console.log('📩 Webhook recebido:', event.type);

    if (event.type === 'payment' && event.data?.id) {
      const paymentId = event.data.id;
      const paymentInfo = await mercadopago.payment.get(paymentId);
      console.log(`💰 Status do pagamento ${paymentId}:`, paymentInfo.body.status);

      if (paymentInfo.body.status === 'approved') {
        /* [5.1] VALIDAÇÃO DO E-MAIL RECEBIDO DO FRONTEND */
        const email = paymentInfo.body.additional_info.items[0]?.payer_email;
        
        // Validação rigorosa do formato do e-mail
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          console.error('❌ E-mail ausente ou inválido:', { 
            paymentId,
            email 
          });
          return res.status(400).json({
            status: 'erro',
            message: 'E-mail do cliente inválido ou não fornecido',
            codigo: 'EMAIL_INVALIDO'
          });
        }

        /* [5.2] IDENTIFICAÇÃO DO PLANO COMPRADO */
        const item = paymentInfo.body.additional_info.items[0];
        const plano = item.title.replace('Plano ', '').toLowerCase().trim();
        const nomeArquivoPDF = planos[plano];

        if (!nomeArquivoPDF) {
          console.error('⚠️ Plano não reconhecido:', { 
            paymentId,
            planoSolicitado: plano 
          });
          return res.status(400).json({
            status: 'erro',
            message: 'Plano contratado não existe'
          });
        }

        /* [5.3] PROCESSAMENTO DO ENVIO DE E-MAIL */
        try {
          const pdfPath = path.join(__dirname, nomeArquivoPDF);
          console.log('✉️ Preparando envio para:', email);

          await transporter.sendMail({
            from: 'oficialfinanzap@gmail.com',
            to: email,
            subject: '✅ Seu material exclusivo chegou!',
            text: `Olá!\n\nAqui está seu guia do ${item.title}.\n\nAgradecemos sua compra!`,
            attachments: [{
              filename: nomeArquivoPDF,
              path: pdfPath,
              contentType: 'application/pdf'
            }]
          });

          console.log(`✅ E-mail enviado com sucesso para: ${email}`);
          return res.json({ 
            status: 'sucesso', 
            message: 'Material enviado com sucesso' 
          });

        } catch (emailError) {
          console.error('❌ Erro no envio do e-mail:', {
            error: emailError.message,
            paymentId,
            email
          });
          return res.status(500).json({
            status: 'erro',
            message: 'Falha ao enviar o material',
            detalhes: emailError.message
          });
        }
      }
      return res.json({ status: 'pendente', message: 'Pagamento não aprovado' });
    }
    res.json({ status: 'ignorado', message: 'Evento não suportado' });

  } catch (error) {
    console.error('🔥 Erro crítico:', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      status: 'erro',
      message: 'Falha no processamento',
      detalhes: error.message
    });
  }
});

/* [6] ROTA DE CRIAÇÃO DE PAGAMENTO PIX */
app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;

    // Validação básica dos dados recebidos
    if (!email || !plano || !planos[plano]) {
      return res.status(400).json({
        error: 'Dados inválidos ou incompletos'
      });
    }

    const paymentData = {
      statement_descriptor: 'Finanzap',
      transaction_amount: 1.00,
      description: `Assinatura ${plano}`,
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: uuidv4(),
      additional_info: {
        items: [{
          id: 'finanzap_001',
          title: `Plano ${plano}`,
          description: 'Acesso completo à plataforma',
          category_id: 'services',
          quantity: 1,
          unit_price: 1.00,
          payer_email: email // Armazenamos o e-mail do frontend aqui
        }]
      },
      payer: {
        email: email,
        first_name: 'Cliente',
        last_name: 'Finanzap',
        identification: {
          type: 'CPF',
          number: '12345678909'
        }
      }
    };

    const response = await mercadopago.payment.create(paymentData);
    const qrData = response.body.point_of_interaction?.transaction_data;

    res.json({
      paymentId: response.body.id,
      qrCode: qrData?.qr_code,
      qrCodeBase64: qrData?.qr_code_base64,
      status: response.body.status
    });

  } catch (error) {
    console.error('💥 Erro na criação do pagamento:', {
      error: error.message
    });
    res.status(500).json({
      error: 'Erro no processamento',
      detalhes: error.message
    });
  }
});

/* [7] OUTRAS CONFIGURAÇÕES (MANTIDAS) */
app.get('/status-pagamento/:paymentId', async (req, res) => {
  // ... (código mantido igual)
});

// ... (demais funções auxiliares mantidas)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
