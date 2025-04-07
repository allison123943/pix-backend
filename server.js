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

// ====================== 🔐 CREDENCIAIS ======================
const ACCESS_TOKEN = 'APP_USR-2190858428063851-040509-f8899b0779b8753d85dae14f27892a0d-287816612';
const WEBHOOK_SECRET = '01d71aa758c6c87c2190438452b1dd6d52c06f2975fa56a221f6f324bbfa1482';
const WEBHOOK_URL = 'https://pix-backend-79lq.onrender.com/webhook';
// ============================================================

console.log('🚀 Inicializando servidor Finanzap...');
mercadopago.configure({ access_token: ACCESS_TOKEN });

// ================== 📧 CONFIGURAÇÃO DE E-MAIL ==================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'oficialfinanzap@gmail.com',
    pass: 'hrirzodqitdzwvrb' // ⚠️ ALTERAR PARA SENHA REAL
  }
});

transporter.verify(error => {
  if (error) console.error('❌ Erro no serviço de e-mail:', error);
  else console.log('✅ Serviço de e-mail configurado!');
});

// ================== 📁 PLANOS E PREÇOS ==================
const planos = {
  normal: 'instrucoesAssistenteFinanceiro.pdf',
  casal: 'instrucoesassistentefinanceiroplanocasal.pdf',
  familia: 'instrucoes_assistentefinanceiroplanofamilia.pdf'
};

const precos = {
  normal: 27.50,
  casal: 48.00,
  familia: 55.00
};

const pagamentosAprovados = new Map();

// ================== 📨 FUNÇÃO DE ENVIO DE PDF ==================
async function enviarPDFPorEmail(email, plano) {
  try {
    const pdfPath = path.join(__dirname, planos[plano]);
    if (!fs.existsSync(pdfPath)) throw new Error('PDF não encontrado');

    const mailOptions = {
      from: 'Finanzap <oficialfinanzap@gmail.com>',
      to: email,
      subject: '📚 Seu Material Finanzap',
      html: `<div style="font-family: Arial;">
              <h1>Material do Plano ${plano}!</h1>
              <p>Anexo: Instruções completas</p>
            </div>`,
      attachments: [{
        filename: `Finanzap_${plano}.pdf`,
        path: pdfPath
      }]
    };

    return await transporter.sendMail(mailOptions);
  } catch (error) {
    throw new Error(`Falha no envio: ${error.message}`);
  }
}

// ================== 🔒 VERIFICAÇÃO WEBHOOK ==================
function verifySignature(req, secret) {
  const signature = req.headers['x-mp-signature'];
  const hash = crypto.createHmac('sha256', secret)
                   .update(JSON.stringify(req.body))
                   .digest('hex');
  return signature === hash;
}

// ================== ⚡ ENDPOINTS ==================

// ------------------ WEBHOOK ------------------
app.post('/webhook', async (req, res) => {
  if (!verifySignature(req, WEBHOOK_SECRET)) {
    return res.status(401).send('Assinatura inválida');
  }

  try {
    const paymentId = req.body.data.id;
    const paymentInfo = await mercadopago.payment.get(paymentId);

    if (paymentInfo.body.status === 'approved') {
      const plano = paymentInfo.body.additional_info.items[0].title.split(' ')[1].toLowerCase();
      pagamentosAprovados.set(paymentId, {
        plano,
        email: paymentInfo.body.payer.email,
        data: new Date()
      });
      return res.status(200).json({ status: 'success', paymentId });
    }

    res.status(200).json({ status: paymentInfo.body.status });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------ CRIAR PAGAMENTO ------------------
app.post('/criar-pagamento', async (req, res) => {
  const { email, plano } = req.body;
  
  if (!precos[plano]) {
    return res.status(400).json({ error: 'Plano inválido' });
  }

  try {
    const paymentData = {
      transaction_amount: precos[plano],
      description: `Plano ${plano}`,
      payment_method_id: 'pix',
      notification_url: WEBHOOK_URL,
      external_reference: uuidv4(),
      payer: { email },
      additional_info: {
        items: [{
          title: `Plano ${plano}`,
          quantity: 1,
          unit_price: precos[plano]
        }]
      }
    };

    const response = await mercadopago.payment.create(paymentData);
    
    res.json({
      paymentId: response.body.id,
      qrCode: response.body.point_of_interaction.transaction_data.qr_code,
      qrCodeBase64: response.body.point_of_interaction.transaction_data.qr_code_base64
    });

  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      details: error.response?.data 
    });
  }
});

// ------------------ STATUS PAGAMENTO ------------------
app.get('/status-pagamento/:paymentId', async (req, res) => {
  try {
    const response = await mercadopago.payment.get(req.params.paymentId);
    res.json({ 
      status: response.body.status,
      last_update: response.body.date_last_updated
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ------------------ CONFIRMAR E-MAIL ------------------
app.post('/confirmar-email', async (req, res) => {
  const { paymentId, email } = req.body;

  try {
    if (!pagamentosAprovados.has(paymentId)) {
      const paymentInfo = await mercadopago.payment.get(paymentId);
      if (paymentInfo.body.status !== 'approved') throw new Error('Pagamento não aprovado');
      
      const plano = paymentInfo.body.additional_info.items[0].title.split(' ')[1].toLowerCase();
      pagamentosAprovados.set(paymentId, { 
        plano, 
        email: paymentInfo.body.payer.email 
      });
    }

    const { plano } = pagamentosAprovados.get(paymentId);
    await enviarPDFPorEmail(email, plano);
    pagamentosAprovados.delete(paymentId);

    res.json({ success: true, message: 'PDF enviado!' });

  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// ================== 🚀 INICIAR SERVIDOR ==================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🔥 Servidor rodando na porta ${PORT}`);
  console.log(`📌 Webhook: ${WEBHOOK_URL}\n`);
});