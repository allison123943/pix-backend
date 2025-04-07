const express = require('express');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mercadopago = require('mercadopago');

const app = express();
app.use(cors());
app.use(express.json());

const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';

mercadopago.configure({ access_token: ACCESS_TOKEN });

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'hrirzodqitdzwvrb'
  }
});

const planos = {
  normal: 'Instrucoes_Assistente_Financeiro.pdf',
  casal: 'instrucoes_assistente_financeiro_plano_casal.pdf',
  familia: 'instrucoes_assistente_financeiro_plano_familia.pdf'
};

// Funções auxiliares
function validarEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function verifySignature(req, secret) {
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return signature === hash;
}

// Rota do webhook
app.post('/webhook', async (req, res) => {
  try {
    // if (!verifySignature(req, WEBHOOK_SECRET)) {
    //   return res.status(401).json({ status: 'erro', message: 'Assinatura inválida' });
    // }

    const event = req.body;
    console.log('Webhook recebido:', event.type);

    if (event.type === 'payment' && event.data?.id) {
      const paymentId = event.data.id;
      const paymentInfo = await mercadopago.payment.get(paymentId);
      
      if (paymentInfo.body.status === 'approved') {
        // Captura do e-mail do additional_info
        const item = paymentInfo.body.additional_info.items[0];
        const email = item.payer_email;

        if (!email || !validarEmail(email)) {
          console.error('E-mail inválido:', email);
          return res.status(400).json({ 
            status: 'erro', 
            message: 'E-mail do cliente inválido' 
          });
        }

        // Processamento do plano
        const plano = item.title.replace('Plano ', '').toLowerCase();
        const arquivoPDF = planos[plano];

        if (!arquivoPDF) {
          return res.status(400).json({
            status: 'erro',
            message: 'Plano não encontrado'
          });
        }

        // Envio do e-mail
        try {
          const pdfPath = path.join(__dirname, arquivoPDF);
          await transporter.sendMail({
            from: 'oficialfinanzap@gmail.com',
            to: email,
            subject: '✅ Seu material exclusivo chegou!',
            text: `Olá!\n\nAqui está seu guia do ${item.title}.\n\nAgradecemos sua compra!`,
            attachments: [{
              filename: arquivoPDF,
              path: pdfPath,
              contentType: 'application/pdf'
            }]
          });
          
          return res.json({ 
            status: 'sucesso', 
            message: 'E-mail enviado com sucesso' 
          });
          
        } catch (emailError) {
          console.error('Erro no envio do e-mail:', emailError);
          return res.status(500).json({
            status: 'erro',
            message: 'Falha ao enviar o e-mail'
          });
        }
      }
      return res.json({ status: 'pendente', message: 'Pagamento não aprovado' });
    }
    res.json({ status: 'ignorado', message: 'Evento não tratado' });

  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).json({ 
      status: 'erro', 
      message: 'Erro no processamento' 
    });
  }
});

// Rota para criar pagamento
app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;

    if (!email || !plano || !planos[plano.toLowerCase()]) {
      return res.status(400).json({ 
        error: 'Dados inválidos: e-mail e plano obrigatórios' 
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
          payer_email: email  // Armazena o e-mail do frontend aqui
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

    res.json({
      paymentId: response.body.id,
      qrCode: response.body.point_of_interaction?.transaction_data?.qr_code,
      qrCodeBase64: response.body.point_of_interaction?.transaction_data?.qr_code_base64,
      status: response.body.status
    });

  } catch (error) {
    console.error('Erro ao criar pagamento:', error);
    res.status(500).json({ 
      error: 'Erro interno ao processar pagamento', 
      details: error.message 
    });
  }
});

app.get('/status-pagamento/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const response = await mercadopago.payment.get(paymentId);
    res.json({ 
      status: response.body.status,
      detalhes: response.body.status_detail 
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Erro ao verificar pagamento', 
      details: error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
