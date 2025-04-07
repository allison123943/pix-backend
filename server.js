const express = require('express');
const cors = require('cors');
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
    pass: 'irordtnnykrddujv'
  }
});

const planos = {
  normal: 'Instrucoes_Assistente_Financeiro.pdf',
  casal: 'instrucoes_assistente_financeiro_plano_casal.pdf',
  familia: 'instrucoes_assistente_financeiro_plano_familia.pdf'
};

function verifySignature(req, secret) {
  const signature = req.headers['x-mp-signature'] || '';
  const hash = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
  return signature === hash;
}

app.post('/webhook', async (req, res) => {
  try {
    if (!verifySignature(req, WEBHOOK_SECRET)) {
      return res.status(401).send('Assinatura inválida');
    }

    const event = req.body;
    console.log('Webhook recebido:', JSON.stringify(event, null, 2));

    if (event.type === 'payment' && event.data?.id) {
      const paymentId = event.data.id;
      
      const payment = await mercadopago.payment.get(paymentId);
      const paymentStatus = payment.body.status;
      
      console.log(`Status do pagamento ${paymentId}: ${paymentStatus}`);

      if (paymentStatus === 'approved') {
        const payerEmail = payment.body.payer.email;
        const itemTitle = payment.body.additional_info.items[0].title;
        const plan = itemTitle.split(' ')[1].toLowerCase();
        
        console.log(`Pagamento aprovado para ${payerEmail}, plano: ${plan}`);

        const pdfFileName = planos[plan];
        if (!pdfFileName) {
          throw new Error(`Plano não reconhecido: ${plan}`);
        }

        const pdfPath = path.join(__dirname, pdfFileName);
        if (!fs.existsSync(pdfPath)) {
          throw new Error(`Arquivo não encontrado: ${pdfFileName}`);
        }

        const mailOptions = {
          from: 'oficialfinanzap@gmail.com',
          to: payerEmail,
          subject: '📄 Seu Material do Finanzap',
          text: 'Obrigado por sua compra! Segue em anexo o material do seu plano.',
          attachments: [{
            filename: pdfFileName,
            path: pdfPath
          }]
        };

        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.error('Erro ao enviar e-mail:', error);
          } else {
            console.log('E-mail enviado com sucesso:', info.response);
          }
        });
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.status(500).send('Erro interno');
  }
});

app.post('/criar-pagamento', async (req, res) => {
  try {
    const { email, plano } = req.body;

    if (!email || !plano) {
      return res.status(400).json({ error: 'Dados incompletos: email e plano são obrigatórios' });
    }

    const idempotencyKey = uuidv4();
    const valor = plano === 'normal' ? 27.50 : 1;
    const externalReference = uuidv4();

    const payment_data = {
      statement_descriptor: 'Finanzap',
      transaction_amount: parseFloat(valor.toFixed(2)),
      description: 'Finanzap',
      additional_info: {
        items: [{
          id: 'finanzap_001',
          title: `Plano ${plano}`,
          description: 'Acesso ao Assistente Financeiro',
          category_id: 'services',
          quantity: 1,
          unit_price: parseFloat(valor.toFixed(2))
        }]
      },
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: externalReference,
      payer: { 
        email: email, 
        first_name: 'Cliente', 
        last_name: 'PIX', 
        identification: { 
          type: 'CPF', 
          number: '12345678909' 
        } 
      }
    };

    const response = await mercadopago.payment.create(payment_data);

    if (response.body && response.body.id) {
      res.json({
        paymentId: response.body.id,
        qrCode: response.body.point_of_interaction?.transaction_data?.qr_code,
        qrCodeBase64: response.body.point_of_interaction?.transaction_data?.qr_code_base64,
        status: response.body.status
      });
    } else {
      res.status(500).json({ error: 'Erro ao criar pagamento', details: response.body });
    }
  } catch (error) {
    res.status(500).json({ 
      error: 'Erro ao criar pagamento', 
      details: error.response?.data || error.message 
    });
  }
});

app.get('/status-pagamento/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const response = await mercadopago.payment.get(paymentId);
    res.json({ status: response.body.status });
  } catch (error) {
    res.status(500).json({ 
      error: 'Erro ao verificar pagamento', 
      details: error.response?.data || error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});