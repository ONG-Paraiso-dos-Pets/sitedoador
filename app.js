/**
 * @fileoverview Lógica de front-end para el formulario de captación de donadores de la ONG Paraíso dos Pets.
 * Por qué esta arquitectura: aplica el principio de responsabilidad única (SOLID) separando
 * las reglas de validación de los 3 campos obligatorios (Nome completo, Telefone brasileño y E-mail)
 * de la manipulación del DOM, evitando referencias nulas y condiciones de carrera.
 */

(() => {
  'use strict';

  /**
   * Registro estructurado de baja cardinalidad para depuración segura sin exponer credenciales.
   * Por qué: mantiene mensajes de registro estables y predecibles para monitoreo.
   */
  const logger = {
    /**
     * Registra un evento informativo con contexto estructurado.
     * @param {Record<string, unknown>} context - Metadatos de baja cardinalidad.
     * @param {string} message - Mensaje descriptivo estable.
     * @returns {void}
     */
    info(context, message) {
      if (typeof console !== 'undefined' && typeof console.info === 'function') {
        console.info(context, message);
      }
    },

    /**
     * Registra un error controlado sin interrumpir el flujo del usuario.
     * @param {Record<string, unknown>} context - Metadatos del error capturado.
     * @param {string} message - Mensaje estable de error.
     * @returns {void}
     */
    error(context, message) {
      if (typeof console !== 'undefined' && typeof console.error === 'function') {
        console.error(context, message);
      }
    }
  };

  /**
   * Mapa oficial de códigos DDD válidos en Brasil según ANATEL.
   * Por qué: impide que se registren teléfonos con códigos de área inexistentes en Brasil.
   * @type {Readonly<Record<string, string>>}
   */
  const BRAZIL_DDD_REGIONS = Object.freeze({
    '11': 'São Paulo · SP',
    '12': 'Vale do Paraíba · SP',
    '13': 'Baixada Santista · SP',
    '14': 'Bauru e Marília · SP',
    '15': 'Sorocaba · SP',
    '16': 'Ribeirão Preto e região · SP',
    '17': 'São José do Rio Preto · SP',
    '18': 'Presidente Prudente · SP',
    '19': 'Campinas e região · SP',
    '21': 'Rio de Janeiro · RJ',
    '22': 'Campos dos Goytacazes · RJ',
    '24': 'Volta Redonda e Petrópolis · RJ',
    '27': 'Vitória e região · ES',
    '28': 'Cachoeiro de Itapemirim · ES',
    '31': 'Belo Horizonte · MG',
    '32': 'Juiz de Fora · MG',
    '33': 'Governador Valadares · MG',
    '34': 'Uberlândia e Triângulo · MG',
    '35': 'Poços de Caldas e Sul · MG',
    '37': 'Divinópolis · MG',
    '38': 'Montes Claros · MG',
    '41': 'Curitiba · PR',
    '42': 'Ponta Grossa · PR',
    '43': 'Londrina · PR',
    '44': 'Maringá · PR',
    '45': 'Foz do Iguaçu · PR',
    '46': 'Francisco Beltrão · PR',
    '47': 'Joinville e Blumenau · SC',
    '48': 'Florianópolis · SC',
    '49': 'Chapecó · SC',
    '51': 'Porto Alegre · RS',
    '53': 'Pelotas · RS',
    '54': 'Caxias do Sul · RS',
    '55': 'Santa Maria · RS',
    '61': 'Brasília · DF',
    '62': 'Goiânia · GO',
    '63': 'Palmas · TO',
    '64': 'Rio Verde · GO',
    '65': 'Cuiabá · MT',
    '66': 'Rondonópolis · MT',
    '67': 'Campo Grande · MS',
    '68': 'Rio Branco · AC',
    '69': 'Porto Velho · RO',
    '71': 'Salvador · BA',
    '73': 'Ilhéus e Itabuna · BA',
    '74': 'Juazeiro · BA',
    '75': 'Feira de Santana · BA',
    '77': 'Vitória da Conquista · BA',
    '79': 'Aracaju · SE',
    '81': 'Recife · PE',
    '82': 'Maceió · AL',
    '83': 'João Pessoa · PB',
    '84': 'Natal · RN',
    '85': 'Fortaleza · CE',
    '86': 'Teresina · PI',
    '87': 'Petrolina · PE',
    '88': 'Juazeiro do Norte · CE',
    '89': 'Picos · PI',
    '91': 'Belém · PA',
    '92': 'Manaus · AM',
    '93': 'Santarém · PA',
    '94': 'Marabá · PA',
    '95': 'Boa Vista · RR',
    '96': 'Macapá · AP',
    '97': 'Coari · AM',
    '98': 'São Luís · MA',
    '99': 'Imperatriz · MA'
  });

  /**
   * Estado interno del formulario.
   * Por qué: previene envíos duplicados por doble clic (condición de carrera).
   */
  const state = {
    isSubmitting: false
  };

  /**
   * Limpia caracteres no numéricos y normaliza prefijos como +55 o 0 inicial al pegar un teléfono.
   * Por qué: el autocompletado de los navegadores suele incluir el código de país +55.
   * @param {string} rawValue - Valor de entrada del usuario.
   * @returns {string} Cadena de hasta 11 dígitos numéricos.
   */
  function normalizeBrazilianPhoneDigits(rawValue) {
    if (typeof rawValue !== 'string') {
      return '';
    }
    let digits = rawValue.replace(/\D/g, '');
    if (digits.length > 11 && digits.startsWith('55')) {
      digits = digits.slice(2);
    }
    if (digits.startsWith('0') && digits.length > 11) {
      digits = digits.slice(1);
    }
    return digits.slice(0, 11);
  }

  /**
   * Formatea progresivamente los dígitos en la máscara brasileña (DD) 9XXXX-XXXX.
   * Por qué: guía visualmente al donador mientras escribe su teléfono celular.
   * @param {string} digits - Dígitos limpios (máximo 11).
   * @returns {string} Teléfono con formato brasileño.
   */
  function formatBrazilianMobileMask(digits) {
    if (!digits) {
      return '';
    }
    if (digits.length <= 2) {
      return `(${digits}`;
    }
    const ddd = digits.slice(0, 2);
    const subscriber = digits.slice(2);
    if (subscriber.length <= 5) {
      return `(${ddd}) ${subscriber}`;
    }
    const firstPart = subscriber.slice(0, 5);
    const secondPart = subscriber.slice(5, 9);
    return `(${ddd}) ${firstPart}-${secondPart}`;
  }

  /**
   * Valida que el teléfono ingresado cumpla con el formato móvil brasileño (DDD válido + 9 dígitos).
   * Por qué: garantiza que la ONG pueda contactar al donador por WhatsApp o llamada sin números inválidos.
   * @param {string} rawValue - Valor actual del campo de teléfono.
   * @returns {{isValid: boolean, message: string, formatted: string, dddRegion: string}} Resultado de validación.
   */
  function validateBrazilianMobile(rawValue) {
    const digits = normalizeBrazilianPhoneDigits(rawValue);
    const formatted = formatBrazilianMobileMask(digits);

    if (digits.length === 0) {
      return {
        isValid: false,
        message: 'Informe seu telefone celular com DDD. Ex.: (16) 99999-9999.',
        formatted,
        dddRegion: ''
      };
    }

    if (digits.length < 2) {
      return {
        isValid: false,
        message: 'Digite os 2 dígitos do DDD.',
        formatted,
        dddRegion: ''
      };
    }

    const ddd = digits.slice(0, 2);
    const dddRegion = BRAZIL_DDD_REGIONS[ddd] || '';

    if (!dddRegion) {
      return {
        isValid: false,
        message: `O DDD (${ddd}) não é válido no Brasil.`,
        formatted,
        dddRegion: ''
      };
    }

    const thirdDigit = digits.charAt(2);
    if (thirdDigit && thirdDigit !== '9') {
      return {
        isValid: false,
        message: `Celulares no Brasil iniciam com 9 após o DDD (${ddd}).`,
        formatted,
        dddRegion
      };
    }

    if (digits.length < 11) {
      const remaining = 11 - digits.length;
      return {
        isValid: false,
        message: `Faltam ${remaining} dígito${remaining > 1 ? 's' : ''} para completar o número.`,
        formatted,
        dddRegion
      };
    }

    const subscriber = digits.slice(2);
    if (/^9(\d)\1{7}$/.test(subscriber)) {
      return {
        isValid: false,
        message: 'Informe um número de telefone válido.',
        formatted,
        dddRegion
      };
    }

    return {
      isValid: true,
      message: '',
      formatted,
      dddRegion
    };
  }

  /**
   * Valida que el campo de nombre completo contenga al menos nombre y apellido.
   * Por qué: evita registros incompletos o de una sola letra.
   * @param {string} rawName - Valor ingresado en el campo de nombre.
   * @returns {{isValid: boolean, message: string, cleanName: string}} Resultado de validación.
   */
  function validateDonorName(rawName) {
    const cleanName = typeof rawName === 'string' ? rawName.trim().replace(/\s+/g, ' ') : '';
    if (cleanName.length < 3) {
      return {
        isValid: false,
        message: 'Informe seu nome completo.',
        cleanName
      };
    }
    const parts = cleanName.split(' ');
    if (parts.length < 2 || parts[1].length < 2) {
      return {
        isValid: false,
        message: 'Digite seu nome e sobrenome.',
        cleanName
      };
    }
    return {
      isValid: true,
      message: '',
      cleanName
    };
  }

  /**
   * Valida el formato del correo electrónico del donador.
   * Por qué: asegura que el correo tenga usuario, dominio y extensión válidos antes de aceptar el registro.
   * @param {string} rawEmail - Correo ingresado por el donador.
   * @returns {{isValid: boolean, message: string, cleanEmail: string}} Resultado de validación.
   */
  function validateDonorEmail(rawEmail) {
    const cleanEmail = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if (!cleanEmail) {
      return {
        isValid: false,
        message: 'Informe seu e-mail.',
        cleanEmail
      };
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailPattern.test(cleanEmail)) {
      return {
        isValid: false,
        message: 'Digite um e-mail válido. Ex.: voce@exemplo.com.br',
        cleanEmail
      };
    }
    return {
      isValid: true,
      message: '',
      cleanEmail
    };
  }

  /**
   * Actualiza los atributos de accesibilidad y mensajes de error de cada campo en el DOM.
   * Por qué: centraliza la lógica visual de validación respetando el principio DRY.
   * @param {HTMLInputElement | null} inputEl - Elemento de entrada a actualizar.
   * @param {HTMLElement | null} feedbackEl - Elemento donde se muestra el mensaje de ayuda/error.
   * @param {{isValid: boolean, message: string}} validation - Resultado devuelto por el validador.
   * @param {boolean} showInvalid - Indica si debe mostrarse el estado de error al usuario.
   * @returns {void}
   */
  function renderFieldStatus(inputEl, feedbackEl, validation, showInvalid) {
    if (!inputEl || !feedbackEl) {
      return;
    }

    if (validation.isValid) {
      inputEl.setAttribute('aria-invalid', 'false');
      inputEl.setAttribute('data-valid', 'true');
      feedbackEl.textContent = '';
      feedbackEl.classList.remove('is-error', 'is-valid');
      return;
    }

    inputEl.removeAttribute('data-valid');
    if (showInvalid) {
      inputEl.setAttribute('aria-invalid', 'true');
      feedbackEl.textContent = validation.message;
      feedbackEl.classList.add('is-error');
      feedbackEl.classList.remove('is-valid');
    } else {
      inputEl.setAttribute('aria-invalid', 'false');
      feedbackEl.textContent = '';
      feedbackEl.classList.remove('is-error', 'is-valid');
    }
  }

  /**
   * Inicializa los eventos del formulario de los 3 campos del donador y la navegación desde las fotos.
   * Por qué: verifica la existencia de cada nodo del DOM antes de enlazar eventos para evitar
   * excepciones de puntero nulo.
   * @returns {void}
   */
  function initDonorCaptureForm() {
    const formEl = document.getElementById('donor-capture-form');
    const nameInput = /** @type {HTMLInputElement | null} */ (document.getElementById('donor-name'));
    const phoneInput = /** @type {HTMLInputElement | null} */ (document.getElementById('donor-phone'));
    const emailInput = /** @type {HTMLInputElement | null} */ (document.getElementById('donor-email'));

    const nameFeedback = document.getElementById('donor-name-feedback');
    const phoneFeedback = document.getElementById('donor-phone-feedback');
    const emailFeedback = document.getElementById('donor-email-feedback');

    const successPanel = document.getElementById('donor-success-panel');
    const summaryName = document.getElementById('summary-donor-name');
    const summaryPhone = document.getElementById('summary-donor-phone');
    const summaryEmail = document.getElementById('summary-donor-email');
    const resetFormBtn = document.getElementById('reset-donor-form-btn');

    if (!formEl || !nameInput || !phoneInput || !emailInput) {
      logger.error({ id: 'donor-capture-form' }, 'Missing required form elements');
      return;
    }

    /* Por qué este listener en las fotos de los perros: lleva suavemente al visitante de regreso
       al formulario de cadastro cuando hace clic en cualquiera de los retratos del abrigo. */
    document.querySelectorAll('[data-scroll-to-form]').forEach((panel) => {
      panel.addEventListener('click', () => {
        const cadastroSection = document.getElementById('cadastro');
        if (cadastroSection) {
          cadastroSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        window.setTimeout(() => {
          nameInput.focus({ preventScroll: true });
        }, 400);
      });
    });

    nameInput.addEventListener('input', () => {
      const res = validateDonorName(nameInput.value);
      renderFieldStatus(nameInput, nameFeedback, res, false);
    });

    nameInput.addEventListener('blur', () => {
      const res = validateDonorName(nameInput.value);
      renderFieldStatus(nameInput, nameFeedback, res, Boolean(nameInput.value.trim()));
    });

    phoneInput.addEventListener('input', () => {
      const res = validateBrazilianMobile(phoneInput.value);
      if (phoneInput.value !== res.formatted) {
        phoneInput.value = res.formatted;
      }
      renderFieldStatus(phoneInput, phoneFeedback, res, false);
    });

    phoneInput.addEventListener('blur', () => {
      const res = validateBrazilianMobile(phoneInput.value);
      phoneInput.value = res.formatted;
      renderFieldStatus(phoneInput, phoneFeedback, res, Boolean(phoneInput.value.trim()));
    });

    emailInput.addEventListener('input', () => {
      const res = validateDonorEmail(emailInput.value);
      renderFieldStatus(emailInput, emailFeedback, res, false);
    });

    emailInput.addEventListener('blur', () => {
      const res = validateDonorEmail(emailInput.value);
      renderFieldStatus(emailInput, emailFeedback, res, Boolean(emailInput.value.trim()));
    });

    formEl.addEventListener('submit', (event) => {
      event.preventDefault();
      if (state.isSubmitting) {
        return;
      }

      const nameCheck = validateDonorName(nameInput.value);
      const phoneCheck = validateBrazilianMobile(phoneInput.value);
      const emailCheck = validateDonorEmail(emailInput.value);

      renderFieldStatus(nameInput, nameFeedback, nameCheck, true);
      renderFieldStatus(phoneInput, phoneFeedback, phoneCheck, true);
      renderFieldStatus(emailInput, emailFeedback, emailCheck, true);

      if (!nameCheck.isValid) {
        nameInput.focus();
        return;
      }
      if (!phoneCheck.isValid) {
        phoneInput.focus();
        return;
      }
      if (!emailCheck.isValid) {
        emailInput.focus();
        return;
      }

      state.isSubmitting = true;

      try {
        const payload = {
          nome: nameCheck.cleanName,
          telefone: phoneCheck.formatted,
          email: emailCheck.cleanEmail,
          registeredAt: new Date().toISOString()
        };
        window.localStorage.setItem('paraiso_pets_last_donor', JSON.stringify(payload));
      } catch (storageError) {
        logger.error({ error: String(storageError) }, 'Local storage write skipped');
      }

      if (summaryName) {
        summaryName.textContent = nameCheck.cleanName;
      }
      if (summaryPhone) {
        summaryPhone.textContent = phoneCheck.formatted;
      }
      if (summaryEmail) {
        summaryEmail.textContent = emailCheck.cleanEmail;
      }

      formEl.setAttribute('hidden', 'hidden');
      if (successPanel) {
        successPanel.removeAttribute('hidden');
        successPanel.focus();
      }

      logger.info({ dddRegion: phoneCheck.dddRegion }, 'Donor registration completed');
      state.isSubmitting = false;
    });

    if (resetFormBtn && successPanel) {
      resetFormBtn.addEventListener('click', () => {
        successPanel.setAttribute('hidden', 'hidden');
        formEl.removeAttribute('hidden');
        nameInput.focus();
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDonorCaptureForm);
  } else {
    initDonorCaptureForm();
  }
})();
